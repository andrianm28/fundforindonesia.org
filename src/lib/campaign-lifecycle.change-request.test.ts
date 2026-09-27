import { describe, it, expect } from 'vitest';
import {
  ChangeRequestAlreadyPendingError,
  DeadlineRequiredError,
  domainErrorToHttp,
  InvalidTransitionError,
  LifecycleValidationError,
  NotAuthorizedError,
  requestCampaignChange,
} from './campaign-lifecycle';
import {
  campaignRow,
  checklistItemRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * Asking for a change to an Active Campaign (ticket 12, PRD FFI-05): the
 * Fundraiser proposes a new target and/or deadline, which opens a PENDING
 * Verification Request holding the per-Kind checklist snapshot and the
 * proposed values. The Campaign keeps running on its old values until a
 * Verifier approves. Run against the in-memory Prisma stand-in: assertions
 * are about the rows left behind.
 */
const NOW = new Date('2026-09-26T10:00:00Z');
const DEADLINE = new Date('2026-12-31T00:00:00Z');
const NEW_DEADLINE = new Date('2027-03-31T00:00:00Z');
const fundraiser = { userId: 'creator-1', assignments: [] };

const CHECKLIST = [
  checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran', position: 1 }),
];

function activeDb(overrides: Parameters<typeof campaignRow>[0] = {}) {
  return makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', deadline: DEADLINE, targetAmount: 50_000_000, ...overrides })],
    checklistItems: CHECKLIST,
  });
}

describe('requestCampaignChange', () => {
  it('opens a PENDING change request with the checklist snapshot and the proposed values, leaving the Campaign Active on its old values', async () => {
    const db = activeDb();

    const result = await requestCampaignChange(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: fundraiser,
      changes: { targetAmount: 100_000_000, deadline: NEW_DEADLINE.toISOString() },
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
    expect(db.campaign()).toMatchObject({
      lifecycleStatus: 'ACTIVE',
      targetAmount: 50_000_000,
      deadline: DEADLINE,
    });
    expect(db.verificationRequests).toEqual([
      {
        id: result.verificationRequest.id,
        campaignId: 'campaign-1',
        submittedById: 'creator-1',
        submittedAt: NOW,
        checklist: [
          { id: 'rencana-anggaran', label: 'Rencana anggaran', required: true, position: 1, ticked: false },
        ],
        outcome: 'PENDING',
        reason: null,
        decidedById: null,
        decidedAt: null,
        isFirst: false,
        collectingEntityId: 'partner-1',
        proposedChanges: { targetAmount: 100_000_000, deadline: NEW_DEADLINE.toISOString() },
      },
    ]);
    // A change request moves no status, so it logs no status change.
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([]);
  });

  it('accepts a target-only change', async () => {
    const db = activeDb();

    await requestCampaignChange(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: fundraiser,
      changes: { targetAmount: 75_000_000 },
      now: NOW,
    });

    expect(db.verificationRequests[0]).toMatchObject({
      proposedChanges: { targetAmount: 75_000_000 },
    });
  });

  it('refuses while another request is still PENDING, with a 409, writing nothing', async () => {
    // A PENDING request from an earlier change, committed before.
    const seeded = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', deadline: DEADLINE, targetAmount: 50_000_000 })],
      checklistItems: CHECKLIST,
      verificationRequests: [verificationRequestRow({ proposedChanges: { targetAmount: 60_000_000 } })],
    });

    const error = await requestCampaignChange(seeded.prisma as never, {
      campaignId: 'campaign-1',
      actor: fundraiser,
      changes: { targetAmount: 100_000_000 },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ChangeRequestAlreadyPendingError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'CHANGE_REQUEST_ALREADY_PENDING' } });
    expect(seeded.verificationRequests).toHaveLength(1);
    expect(seeded.campaign()).toMatchObject({ targetAmount: 50_000_000 });
  });

  it.each(['DRAFT', 'REJECTED', 'SUBMITTED'] as const)(
    'is refused from %s with a 409, writing nothing',
    async (lifecycleStatus) => {
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus, deadline: DEADLINE, targetAmount: 50_000_000 })],
        checklistItems: CHECKLIST,
      });

      const error = await requestCampaignChange(db.prisma as never, {
        campaignId: 'campaign-1',
        actor: fundraiser,
        changes: { targetAmount: 100_000_000 },
        now: NOW,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect(db.verificationRequests).toEqual([]);
    },
  );

  it.each([
    ['a stranger', { userId: 'stranger-1', assignments: [] }],
    ['an Admin who is not its Fundraiser', { userId: 'admin-1', assignments: ['ADMIN' as const] }],
  ])('refuses %s with 403 NOT_AUTHORIZED, writing nothing', async (_who, actor) => {
    const db = activeDb();

    const error = await requestCampaignChange(db.prisma as never, {
      campaignId: 'campaign-1',
      actor,
      changes: { targetAmount: 100_000_000 },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(db.verificationRequests).toEqual([]);
  });

  it.each([
    ['zero', 0],
    ['a negative amount', -1000],
    ['a fraction', 10.5],
    ['a non-number', 'banyak'],
  ])('refuses a target of %s with a 400, writing nothing', async (_name, targetAmount) => {
    const db = activeDb();

    const error = await requestCampaignChange(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: fundraiser,
      changes: { targetAmount },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
    expect(db.verificationRequests).toEqual([]);
  });

  it('refuses an unreadable deadline with a 400, writing nothing', async () => {
    const db = activeDb();

    const error = await requestCampaignChange(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: fundraiser,
      changes: { deadline: 'kapan-kapan' },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(db.verificationRequests).toEqual([]);
  });

  it('refuses clearing the deadline of a donation Campaign with a 422, writing nothing', async () => {
    const db = activeDb();

    const error = await requestCampaignChange(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: fundraiser,
      changes: { deadline: null },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DeadlineRequiredError);
    expect(db.verificationRequests).toEqual([]);
  });

  it('refuses a change that changes nothing with a 400, writing nothing', async () => {
    const db = activeDb();

    const error = await requestCampaignChange(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: fundraiser,
      changes: { targetAmount: 50_000_000, deadline: DEADLINE.toISOString() },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(db.verificationRequests).toEqual([]);
  });
});
