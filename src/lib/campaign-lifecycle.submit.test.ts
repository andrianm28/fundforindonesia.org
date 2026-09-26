import { describe, it, expect } from 'vitest';
import {
  domainErrorToHttp,
  InvalidTransitionError,
  NotAuthorizedError,
  submitCampaign,
} from './campaign-lifecycle';
import {
  campaignRow,
  checklistItemRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * Submitting a Campaign to a Verifier (verification-request 01): a Draft or
 * Rejected Campaign becomes Submitted and gets a new PENDING Verification
 * Request holding a snapshot of the active checklist. Run against the
 * in-memory Prisma stand-in: assertions are about the rows left behind.
 */
const NOW = new Date('2026-09-26T10:00:00Z');
const owner = { userId: 'creator-1', assignments: [] };

const CHECKLIST = [
  checklistItemRow({ id: 'identitas-fundraiser', label: 'KTP Fundraiser perorangan atau akta pendirian organisasi', position: 1 }),
  checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran', position: 2 }),
  checklistItemRow({ id: 'bukti-masalah', label: 'Bukti masalah', position: 3 }),
];

describe('submitCampaign', () => {
  it('moves a Draft to Submitted, opens one PENDING first request with the checklist snapshot, and logs it', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'DRAFT' })],
      checklistItems: CHECKLIST,
    });

    const result = await submitCampaign(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: owner,
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('SUBMITTED');
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'SUBMITTED' });
    expect(db.verificationRequests).toEqual([
      {
        id: result.verificationRequest.id,
        campaignId: 'campaign-1',
        submittedById: 'creator-1',
        submittedAt: NOW,
        checklist: [
          { id: 'identitas-fundraiser', label: 'KTP Fundraiser perorangan atau akta pendirian organisasi', required: true, position: 1, ticked: false },
          { id: 'rencana-anggaran', label: 'Rencana anggaran', required: true, position: 2, ticked: false },
          { id: 'bukti-masalah', label: 'Bukti masalah', required: true, position: 3, ticked: false },
        ],
        outcome: 'PENDING',
        reason: null,
        decidedById: null,
        decidedAt: null,
        isFirst: true,
      },
    ]);
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'SUBMITTED',
        fromStatus: 'DRAFT',
        toStatus: 'SUBMITTED',
        actorId: 'creator-1',
        capacity: 'FUNDRAISER',
        reason: null,
        createdAt: NOW,
      }),
    ]);
  });

  it('resubmits a Rejected Campaign as a new, non-first request, keeping the rejected one as it was', async () => {
    const rejected = verificationRequestRow({
      id: 'verification-old',
      outcome: 'REJECTED',
      reason: 'Rencana anggaran tidak dilampirkan.',
      decidedById: 'verifier-1',
      decidedAt: new Date('2026-09-25T08:00:00Z'),
    });
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'REJECTED' })],
      checklistItems: CHECKLIST,
      verificationRequests: [rejected],
    });

    const result = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, now: NOW });

    expect(result.campaign.lifecycleStatus).toBe('SUBMITTED');
    expect(db.verificationRequests).toHaveLength(2);
    expect(db.verificationRequests[0]).toEqual(rejected);
    expect(db.verificationRequests[1]).toMatchObject({ outcome: 'PENDING', isFirst: false, submittedAt: NOW });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'SUBMITTED', fromStatus: 'REJECTED', toStatus: 'SUBMITTED' }),
    ]);
  });

  it('snapshots only the active checklist items, in position order', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'DRAFT' })],
      checklistItems: [
        checklistItemRow({ id: 'second', label: 'Kedua', position: 2 }),
        checklistItemRow({ id: 'retired', label: 'Tidak dipakai lagi', position: 0, active: false }),
        checklistItemRow({ id: 'first', label: 'Pertama', position: 1, required: false }),
      ],
    });

    await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, now: NOW });

    expect(db.verificationRequests[0].checklist).toEqual([
      { id: 'first', label: 'Pertama', required: false, position: 1, ticked: false },
      { id: 'second', label: 'Kedua', required: true, position: 2, ticked: false },
    ]);
  });

  it.each(['SUBMITTED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED', 'EXPIRED'] as const)(
    'is refused from %s with a 409, writing nothing',
    async (lifecycleStatus) => {
      const db = makeCampaignDb({
        campaigns: [campaignRow({ lifecycleStatus })],
        checklistItems: CHECKLIST,
      });

      const error = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, now: NOW }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect(domainErrorToHttp(error)?.status).toBe(409);
      expect(db.campaign().lifecycleStatus).toBe(lifecycleStatus);
      expect(db.verificationRequests).toEqual([]);
      expect(db.statusChanges).toEqual([]);
    },
  );

  it.each([
    ['a stranger', { userId: 'stranger-1', assignments: [] }],
    ['an Admin who does not own it', { userId: 'admin-1', assignments: ['ADMIN' as const] }],
    ['a Verifier who does not own it', { userId: 'verifier-1', assignments: ['VERIFIER' as const] }],
  ])('refuses %s with 403 NOT_AUTHORIZED, writing nothing', async (_who, actor) => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'DRAFT' })],
      checklistItems: CHECKLIST,
    });

    const error = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 403, body: { code: 'NOT_AUTHORIZED' } });
    expect(db.campaign().lifecycleStatus).toBe('DRAFT');
    expect(db.verificationRequests).toEqual([]);
  });

  it('lets an owner who also holds ADMIN and VERIFIER submit, recorded as Fundraiser', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'DRAFT' })],
      checklistItems: CHECKLIST,
    });

    await submitCampaign(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: { userId: 'creator-1', assignments: ['ADMIN', 'VERIFIER'] },
      now: NOW,
    });

    expect(db.statusChanges).toEqual([expect.objectContaining({ capacity: 'FUNDRAISER' })]);
  });

  it('refuses a second submission committed before ours took the lock, so only one request is PENDING', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'DRAFT' })],
      checklistItems: CHECKLIST,
    });
    db.beforeNextRowLock((data) => {
      data.campaigns[0].lifecycleStatus = 'SUBMITTED';
      data.verificationRequests.push(verificationRequestRow({ id: 'verification-first' }));
    });

    const error = await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(InvalidTransitionError);
    expect(db.verificationRequests.map((r) => r.id)).toEqual(['verification-first']);
  });
});
