import { describe, it, expect } from 'vitest';
import {
  decideVerificationRequest,
  domainErrorToHttp,
  InvalidTransitionError,
  LifecycleValidationError,
  RequiredChecklistItemsUntickedError,
  withdrawVerificationRequest,
} from './campaign-lifecycle';
import {
  campaignRow,
  checklistItemRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * Deciding and withdrawing a change request on an Active Campaign (ticket
 * 12, PRD FFI-05): approving applies the proposed target and/or deadline
 * while the Campaign stays Active; rejecting or withdrawing discards the
 * proposal and the Campaign keeps running on its old values. Run against
 * the in-memory Prisma stand-in: assertions are about the rows left behind.
 */
const NOW = new Date('2026-09-26T10:00:00Z');
const DEADLINE = new Date('2026-12-31T00:00:00Z');
const NEW_DEADLINE = new Date('2027-03-31T00:00:00Z');
const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };
const fundraiser = { userId: 'creator-1', assignments: [] };

const CHECKLIST = [
  { id: 'rencana-anggaran', label: 'Rencana anggaran', required: true, position: 1, ticked: false },
];

function changeDb(overrides: Parameters<typeof makeCampaignDb>[0] = {}) {
  return makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', deadline: DEADLINE, targetAmount: 50_000_000 })],
    checklistItems: [checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran', position: 1 })],
    verificationRequests: [
      verificationRequestRow({
        id: 'verification-change',
        isFirst: false,
        checklist: CHECKLIST,
        // A change request is told apart by its kind, not by the presence of
        // a proposal (prd-compliance 38); this is what the migration that
        // added the column backfilled every existing proposal-carrying row to.
        kind: 'CHANGE',
        proposedChanges: { targetAmount: 100_000_000, deadline: NEW_DEADLINE.toISOString() },
      }),
    ],
    ...overrides,
  });
}

function sentMails() {
  const sent: { to: string; subject: string; text: string; html: string }[] = [];
  const mailer = { name: 'test', send: async (message: (typeof sent)[number]) => void sent.push(message) };
  return { sent, mailer };
}

describe('deciding a change request', () => {
  it('approving applies the proposed target and deadline, keeping the Campaign Active with no status change logged', async () => {
    const db = changeDb();
    const { sent, mailer } = sentMails();

    const result = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-change',
      actor: verifier,
      decision: 'approve',
      ticked: ['rencana-anggaran'],
      now: NOW,
      mailer,
    });

    expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
    expect(db.campaign()).toMatchObject({
      lifecycleStatus: 'ACTIVE',
      targetAmount: 100_000_000,
      deadline: NEW_DEADLINE,
    });
    expect(db.verificationRequests[0]).toMatchObject({
      outcome: 'APPROVED',
      decidedById: 'verifier-1',
      decidedAt: NOW,
    });
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([
      expect.objectContaining({
        title: 'Perubahan Campaign Disetujui',
        userId: 'creator-1',
      }),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('Perubahan');
  });

  it('refuses to approve with a required item unticked, applying nothing (422)', async () => {
    const db = changeDb();

    const error = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-change',
      actor: verifier,
      decision: 'approve',
      ticked: [],
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequiredChecklistItemsUntickedError);
    expect(db.campaign()).toMatchObject({ targetAmount: 50_000_000, deadline: DEADLINE });
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
  });

  it('rejecting with a reason discards the proposal, keeping the Campaign Active on its old values', async () => {
    const db = changeDb();
    const { sent, mailer } = sentMails();

    const result = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-change',
      actor: verifier,
      decision: 'reject',
      reason: 'Target baru tidak didukung rencana anggaran.',
      now: NOW,
      mailer,
    });

    expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
    expect(db.campaign()).toMatchObject({ targetAmount: 50_000_000, deadline: DEADLINE });
    expect(db.verificationRequests[0]).toMatchObject({
      outcome: 'REJECTED',
      reason: 'Target baru tidak didukung rencana anggaran.',
      decidedById: 'verifier-1',
    });
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([
      expect.objectContaining({ title: 'Perubahan Campaign Ditolak', userId: 'creator-1' }),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('Perubahan');
  });

  it('rejecting without a reason is refused with a 400, discarding nothing yet', async () => {
    const db = changeDb();

    const error = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-change',
      actor: verifier,
      decision: 'reject',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 400 });
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
    expect(db.campaign()).toMatchObject({ targetAmount: 50_000_000 });
  });

  it('is refused once the Campaign is no longer Active, with a 409, writing nothing', async () => {
    const db = changeDb({
      campaigns: [campaignRow({ lifecycleStatus: 'SUSPENDED', deadline: DEADLINE, targetAmount: 50_000_000 })],
    });

    const error = await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-change',
      actor: verifier,
      decision: 'reject',
      reason: 'Sudah dibekukan.',
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidTransitionError);
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
    expect(db.campaign()).toMatchObject({ targetAmount: 50_000_000 });
  });
});

describe('withdrawing a change request', () => {
  it('marks the request withdrawn and keeps the Campaign Active on its old values, logging no status change', async () => {
    const db = changeDb();

    const result = await withdrawVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'verification-change',
      actor: fundraiser,
      now: NOW,
    });

    expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
    expect(db.campaign()).toMatchObject({ targetAmount: 50_000_000, deadline: DEADLINE });
    expect(db.verificationRequests[0]).toMatchObject({
      outcome: 'WITHDRAWN',
      decidedById: 'creator-1',
      decidedAt: NOW,
    });
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([
      expect.objectContaining({ title: 'Pengajuan Perubahan Ditarik', userId: 'creator-1' }),
    ]);
  });
});
