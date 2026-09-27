import { describe, it, expect } from 'vitest';
import {
  AmountReviewNotWithdrawableError,
  decideVerificationRequest,
  domainErrorToHttp,
  raiseAmountReviewVerificationRequest,
  withdrawVerificationRequest,
} from './campaign-lifecycle';
import {
  campaignRow,
  checklistItemRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * Verifikasi Tambahan (prd-compliance 38, PRD §"Anti penyalahgunaan"): a
 * Campaign whose Cumulative Gross passes the review threshold earns a second
 * Verifier look. The System raises it, not the Fundraiser, so it moves no
 * status, notifies nobody, and carries no submitter.
 */
const NOW = new Date('2026-09-28T04:00:00Z');
const DEADLINE = new Date('2026-12-31T00:00:00Z');

const CHECKLIST = [checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran', position: 1 })];

function activeDb() {
  return makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', deadline: DEADLINE, targetAmount: 200_000_000 })],
    checklistItems: CHECKLIST,
  });
}

/** The System raises the review inside the settlement's own transaction. */
function raise(
  db: ReturnType<typeof makeCampaignDb>,
  params: { campaignId: string; cumulativeGross: number; threshold: number; now?: Date },
) {
  return (db.prisma as unknown as { $transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T> }).$transaction(
    (tx) => raiseAmountReviewVerificationRequest(tx as never, params)
  );
}

describe('raiseAmountReviewVerificationRequest', () => {
  it('opens one PENDING amount review with the checklist snapshot and the Gross that raised it, under the Campaign row lock', async () => {
    const db = activeDb();

    const raised = await raise(db, {
      campaignId: 'campaign-1',
      cumulativeGross: 120_000_000,
      threshold: 100_000_000,
      now: NOW,
    });

    expect(raised).toMatchObject({
      campaignId: 'campaign-1',
      kind: 'AMOUNT_REVIEW',
      outcome: 'PENDING',
      submittedById: null,
      isFirst: false,
      raisedByAmount: { cumulativeGross: 120_000_000, threshold: 100_000_000 },
      checklist: [
        { id: 'rencana-anggaran', label: 'Rencana anggaran', required: true, position: 1, ticked: false },
      ],
    });
    // It joins the Verifier's queue the way any other open request does.
    expect(db.verificationRequests).toHaveLength(1);
    // Read under the lock, so two settlements that both see the threshold
    // passed cannot both raise one.
    expect(db.rowLocks).toEqual(['Campaign:campaign-1']);
  });

  it('changes no status and tells nobody, however large the Campaign has become', async () => {
    const db = activeDb();

    await raise(db, {
      campaignId: 'campaign-1',
      cumulativeGross: 500_000_000,
      threshold: 100_000_000,
      now: NOW,
    });

    expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([]);
  });

  it('raises nothing when the Campaign already has one, however much more arrives', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', deadline: DEADLINE })],
      checklistItems: CHECKLIST,
      verificationRequests: [
        verificationRequestRow({ kind: 'AMOUNT_REVIEW', submittedById: null, isFirst: false }),
      ],
    });

    const raised = await raise(db, {
      campaignId: 'campaign-1',
      cumulativeGross: 750_000_000,
      threshold: 100_000_000,
      now: NOW,
    });

    expect(raised).toBeNull();
    expect(db.verificationRequests).toHaveLength(1);
  });

  it('raises nothing for a Campaign that does not exist', async () => {
    const db = activeDb();

    expect(
      await raise(db, {
        campaignId: 'campaign-404',
        cumulativeGross: 120_000_000,
        threshold: 100_000_000,
        now: NOW,
      })
    ).toBeNull();
    expect(db.verificationRequests).toEqual([]);
  });
});

/** A Campaign carrying an open amount review, as the settlement leaves it. */
function reviewedDb(lifecycleStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'COMPLETED' = 'ACTIVE') {
  return makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus, deadline: DEADLINE, targetAmount: 200_000_000 })],
    checklistItems: CHECKLIST,
    verificationRequests: [
      verificationRequestRow({
        id: 'amount-review',
        kind: 'AMOUNT_REVIEW',
        submittedById: null,
        isFirst: false,
        raisedByAmount: { cumulativeGross: 120_000_000, threshold: 100_000_000 },
        checklist: [{ id: 'rencana-anggaran', label: 'Rencana anggaran', required: true, position: 1, ticked: false }],
      }),
    ],
  });
}

const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };

function decide(db: ReturnType<typeof reviewedDb>, decision: 'approve' | 'reject', reason?: string) {
  return decideVerificationRequest(db.prisma as never, {
    campaignId: 'campaign-1',
    requestId: 'amount-review',
    actor: verifier,
    decision,
    ticked: ['rencana-anggaran'],
    reason,
    now: NOW,
  });
}

describe('deciding a Verifikasi Tambahan', () => {
  it('records the Verifier and their ticks, and leaves the Campaign exactly as it was', async () => {
    const db = reviewedDb();

    await decide(db, 'approve');

    expect(db.verificationRequests[0]).toMatchObject({
      outcome: 'APPROVED',
      decidedById: 'verifier-1',
      decidedAt: NOW,
    });
    expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(db.statusChanges).toEqual([]);
  });

  it('can still be decided after the Campaign closed, because the money arrived while it was open', async () => {
    const db = reviewedDb('SUSPENDED');

    await decide(db, 'reject', 'Dana masuk dari sumber yang tidak kami kenal.');

    expect(db.verificationRequests[0]).toMatchObject({
      outcome: 'REJECTED',
      reason: 'Dana masuk dari sumber yang tidak kami kenal.',
    });
    expect(db.campaign().lifecycleStatus).toBe('SUSPENDED');
  });

  it('tells the Fundraiser in the app that it was looked at', async () => {
    const db = reviewedDb();

    await decide(db, 'approve');

    expect(db.notifications).toEqual([
      expect.objectContaining({
        userId: 'creator-1',
        title: 'Verifikasi Tambahan Selesai',
        message: expect.stringContaining('tetap berjalan'),
      }),
    ]);
  });

  it('cannot be withdrawn by the Fundraiser it is about', async () => {
    const db = reviewedDb();

    const error = await withdrawVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: 'amount-review',
      actor: { userId: 'creator-1', assignments: [] },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AmountReviewNotWithdrawableError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'AMOUNT_REVIEW_NOT_WITHDRAWABLE' } });
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
    expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
  });
});
