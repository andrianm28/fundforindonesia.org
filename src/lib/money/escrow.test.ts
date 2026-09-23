import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock prisma wholesale, matching src/app/api/webhooks/[provider]/route.test.ts
// and the payout tests. The fake tx below runs the real ledger's
// count/createMany (same simulation as src/lib/money/ledger.test.ts), so
// postTransaction is exercised for real -- assertions below check the rows
// actually handed to ledgerEntry.createMany, not merely that some function
// was called.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { releaseMaturedEscrow, ESCROW_HOLD_DAYS } from './escrow';

const mockPaymentFindMany = prisma.payment.findMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type PaymentRow = {
  id: string;
  amount: number;
  providerFee: number;
  status: string;
  escrowReleaseAt: Date | null;
  escrowReleasedAt: Date | null;
  // Exactly one of these is ever set -- mirrors Payment.donationId/registrationId
  // in the real schema, where the two are mutually exclusive.
  campaignId: string | null;
  tripId: string | null;
};

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId?: string | null;
  paymentId?: string | null;
};

type RefundRow = { paymentId: string; amount: number; status: string };

function makePayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'payment-1',
    amount: 100_000,
    providerFee: 0,
    status: 'PAID',
    escrowReleaseAt: new Date(Date.now() - MS_PER_DAY), // matured yesterday
    escrowReleasedAt: null,
    campaignId: 'campaign-1',
    tripId: null,
    ...overrides,
  };
}

/**
 * A fake "database": a mutable map of Payment rows, a mutable array of
 * LedgerEntry rows, and a fixed list of Refund rows, wired up so
 * `prisma.payment.findMany` applies the exact where-shape releaseMaturedEscrow
 * queries with, and `prisma.$transaction` hands the callback a tx whose
 * $queryRaw/payment.updateMany/refund.findMany/ledgerEntry.* are real enough
 * for postTransaction to run unmocked.
 */
function makeDb(payments: PaymentRow[], ledgerRows: LedgerRow[] = [], refunds: RefundRow[] = []) {
  const paymentState = new Map(payments.map((p) => [p.id, { ...p }]));
  const rows: LedgerRow[] = [...ledgerRows];
  // Every $queryRaw call across every transaction this makeDb's mockTransaction
  // hands out, in order -- so a test can assert which table a given release
  // actually locked (the tagged-template strings array joins back into the
  // literal SQL text).
  const queryRawCalls: TemplateStringsArray[] = [];

  mockPaymentFindMany.mockImplementation(
    async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
      const now = (where.escrowReleaseAt as { lte: Date }).lte;
      const campaignFilter = (where.donation as { campaignId: string } | undefined)?.campaignId;
      const tripFilter = (where.registration as { batch: { tripId: string } } | undefined)?.batch?.tripId;
      const matches = Array.from(paymentState.values()).filter(
        (p) =>
          p.status === where.status &&
          p.escrowReleaseAt !== null &&
          p.escrowReleaseAt.getTime() <= now.getTime() &&
          p.escrowReleasedAt === null &&
          (!campaignFilter || p.campaignId === campaignFilter) &&
          (!tripFilter || p.tripId === tripFilter),
      );
      return matches.slice(0, take ?? matches.length).map((p) =>
        p.campaignId != null
          ? {
              id: p.id,
              amount: p.amount,
              providerFee: p.providerFee,
              donationId: `donation-${p.id}`,
              registrationId: null,
              donation: { campaignId: p.campaignId },
              registration: null,
            }
          : {
              id: p.id,
              amount: p.amount,
              providerFee: p.providerFee,
              donationId: null,
              registrationId: `registration-${p.id}`,
              donation: null,
              registration: { batch: { tripId: p.tripId } },
            },
      );
    },
  );

  function makeTx() {
    return {
      $queryRaw: vi.fn((strings: TemplateStringsArray) => {
        queryRawCalls.push(strings);
        return Promise.resolve([{ id: 'locked' }]);
      }),
      payment: {
        updateMany: vi.fn(async ({ where, data }: { where: { id: string; escrowReleasedAt: null }; data: Record<string, unknown> }) => {
          const row = paymentState.get(where.id);
          if (!row || row.escrowReleasedAt !== where.escrowReleasedAt) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
      refund: {
        findMany: vi.fn(async ({ where }: { where: { paymentId: string } }) =>
          refunds.filter((r) => r.paymentId === where.paymentId).map((r) => ({ amount: r.amount, status: r.status })),
        ),
      },
      ledgerEntry: {
        count: vi.fn(async ({ where }: { where: { transactionId: string } }) =>
          rows.filter((r) => r.transactionId === where.transactionId).length,
        ),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
      },
    };
  }

  mockTransaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()));

  return { paymentState, rows, queryRawCalls };
}

describe('releaseMaturedEscrow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases a payment whose hold matured (8 days old, 7-day hold)', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * MS_PER_DAY);
    const { rows } = makeDb([
      makePayment({ id: 'payment-1', amount: 100_000, escrowReleaseAt: eightDaysAgo, campaignId: 'campaign-1' }),
    ]);

    const result = await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });

    expect(result).toEqual({ releasedCount: 1, consideredCount: 1 });

    const releaseLegs = rows.filter((r) => r.transactionId === 'escrow-release:payment-1');
    expect(releaseLegs).toHaveLength(2);
    const debit = releaseLegs.find((r) => r.direction === 'DEBIT')!;
    const credit = releaseLegs.find((r) => r.direction === 'CREDIT')!;
    expect(debit).toMatchObject({ account: 'ESCROW_HOLD', amount: 100_000, campaignId: 'campaign-1' });
    expect(credit).toMatchObject({ account: 'CAMPAIGN_BALANCE', amount: 100_000, campaignId: 'campaign-1' });
    // Debits equal credits: the ledger's fundamental invariant, checked
    // directly on the rows handed to createMany rather than trusted from
    // postTransaction merely having been called.
    expect(debit.amount).toBe(credit.amount);
  });

  it('does not release a payment whose hold has not matured yet (6 days old, 7-day hold)', async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * MS_PER_DAY);
    const notYetMatured = new Date(sixDaysAgo.getTime() + ESCROW_HOLD_DAYS * MS_PER_DAY); // 1 day from now
    const { rows } = makeDb([makePayment({ id: 'payment-1', escrowReleaseAt: notYetMatured, campaignId: 'campaign-1' })]);

    const result = await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });

    expect(result).toEqual({ releasedCount: 0, consideredCount: 0 });
    expect(rows.filter((r) => r.transactionId === 'escrow-release:payment-1')).toHaveLength(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('never sweeps a payment refused for an amount mismatch (PENDING, escrowReleaseAt null)', async () => {
    const { rows } = makeDb([
      makePayment({ id: 'payment-1', status: 'PENDING', escrowReleaseAt: null, campaignId: 'campaign-1' }),
    ]);

    const result = await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });

    expect(result).toEqual({ releasedCount: 0, consideredCount: 0 });
    expect(rows).toHaveLength(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('never sweeps a payment that has moved to REFUNDED, even if its hold looks matured', async () => {
    // A fully-refunded payment's status moves off PAID -- excluded by the
    // query itself so this never even reaches the per-payment refund lookup.
    const { rows } = makeDb([makePayment({ id: 'payment-1', status: 'REFUNDED', campaignId: 'campaign-1' })]);

    const result = await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });

    expect(result).toEqual({ releasedCount: 0, consideredCount: 0 });
    expect(rows).toHaveLength(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('stamps a fully-refunded payment (refund COMPLETED -- a final outcome) and never reconsiders it', async () => {
    const { rows, paymentState } = makeDb(
      [makePayment({ id: 'payment-1', amount: 50_000, campaignId: 'campaign-1' })],
      [],
      [{ paymentId: 'payment-1', amount: 50_000, status: 'COMPLETED' }],
    );

    const firstSweep = await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });

    // Claimed and finished -- escrowReleasedAt is stamped so this payment is
    // not reconsidered by every future sweep -- but nothing was posted,
    // because this payment's own refund already accounts for its full net.
    expect(firstSweep).toEqual({ releasedCount: 1, consideredCount: 1 });
    expect(paymentState.get('payment-1')!.escrowReleasedAt).not.toBeNull();
    expect(rows.filter((r) => r.transactionId === 'escrow-release:payment-1')).toHaveLength(0);

    // A later sweep never reconsiders it: escrowReleasedAt is no longer
    // null, so it drops out of the query's own predicate.
    const secondSweep = await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });
    expect(secondSweep).toEqual({ releasedCount: 0, consideredCount: 0 });
  });

  it(
    'defers a payment with an in-flight refund rather than stamping it prematurely, then finishes it ' +
      'once the refund resolves',
    async () => {
      // The stranding bug: if the sweep stamped escrowReleasedAt while a
      // refund was still REQUESTED (treating the undecided amount as
      // refunded, i.e. releasing 0), and that refund later came back
      // REJECTED, the money would sit in ESCROW_HOLD forever with nothing
      // left to ever release it -- escrowReleasedAt is not null, so no
      // future sweep would ever look at this payment again.
      const refunds: RefundRow[] = [{ paymentId: 'payment-1', amount: 100_000, status: 'REQUESTED' }];
      const { rows, paymentState } = makeDb(
        [makePayment({ id: 'payment-1', amount: 100_000, campaignId: 'campaign-1' })],
        [],
        refunds,
      );

      const firstSweep = await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });

      // Deferred, not finished: no claim, no post. The payment is still
      // eligible for a later sweep.
      expect(firstSweep).toEqual({ releasedCount: 0, consideredCount: 1 });
      expect(paymentState.get('payment-1')!.escrowReleasedAt).toBeNull();
      expect(rows.filter((r) => r.transactionId === 'escrow-release:payment-1')).toHaveLength(0);

      // The refund is later rejected -- the donor keeps nothing back, so the
      // money is genuinely the campaign's.
      refunds[0].status = 'REJECTED';

      const secondSweep = await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });

      expect(secondSweep).toEqual({ releasedCount: 1, consideredCount: 1 });
      expect(paymentState.get('payment-1')!.escrowReleasedAt).not.toBeNull();
      const releaseLegs = rows.filter((r) => r.transactionId === 'escrow-release:payment-1');
      expect(releaseLegs.find((r) => r.direction === 'CREDIT')).toMatchObject({
        account: 'CAMPAIGN_BALANCE',
        amount: 100_000,
      });
    },
  );

  it('ignores a REJECTED refund -- it never moved money, so it does not reduce the release', async () => {
    const { rows } = makeDb(
      [makePayment({ id: 'payment-1', amount: 50_000, campaignId: 'campaign-1' })],
      [],
      [{ paymentId: 'payment-1', amount: 50_000, status: 'REJECTED' }],
    );

    await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });

    const releaseLegs = rows.filter((r) => r.transactionId === 'escrow-release:payment-1');
    expect(releaseLegs.find((r) => r.direction === 'CREDIT')).toMatchObject({ amount: 50_000 });
  });

  it(
    "caps a release at this payment's own net minus its own refunds, never at a sibling payment's " +
      'still-held money in the same campaign-level ESCROW_HOLD account',
    async () => {
      // The exact scenario the campaign-wide cap got wrong: payment A is
      // matured and fully refunded (nothing left of its own); payment B is a
      // second, unrelated settlement sharing the same campaign's ESCROW_HOLD
      // account and still has its full 100_000 sitting there. Sweeping A must
      // release 0 -- not "borrow" B's still-held money under A's
      // transactionId, which is what capping against the campaign's overall
      // ESCROW_HOLD balance used to do.
      const { rows } = makeDb(
        [makePayment({ id: 'payment-A', amount: 100_000, campaignId: 'campaign-1' })],
        [
          { transactionId: 'settle-A', direction: 'CREDIT', account: 'ESCROW_HOLD', amount: 100_000, campaignId: 'campaign-1' },
          { transactionId: 'settle-B', direction: 'CREDIT', account: 'ESCROW_HOLD', amount: 100_000, campaignId: 'campaign-1' },
        ],
        [{ paymentId: 'payment-A', amount: 100_000, status: 'COMPLETED' }],
      );

      const result = await releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' });

      expect(result.consideredCount).toBe(1);
      const releaseLegsA = rows.filter((r) => r.transactionId === 'escrow-release:payment-A');
      expect(releaseLegsA).toHaveLength(0);
      // Payment B's own settlement leg is the only thing left in the ledger
      // -- untouched, not partially consumed by A's release.
      expect(rows.filter((r) => r.transactionId === 'settle-B')).toHaveLength(1);
    },
  );

  it('posts one set of entries when two release sweeps race for the same matured payment', async () => {
    const { rows, paymentState } = makeDb([makePayment({ id: 'payment-1', amount: 100_000, campaignId: 'campaign-1' })]);

    // A strict FIFO mutex standing in for a real `SELECT ... FOR UPDATE` on
    // the Campaign row: whichever concurrent call reaches $queryRaw first
    // finishes its whole transaction (claim + post) before the other is
    // allowed to proceed, exactly mirroring how the two-transaction race
    // test for approvePayout is built
    // (src/app/api/campaigns/[slug]/payouts/[id]/approve/route.test.ts).
    let tail: Promise<void> = Promise.resolve();
    function enterLock(): Promise<() => void> {
      let release!: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      const acquired = tail.then(() => release);
      tail = next;
      return acquired;
    }

    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let releaseLock: (() => void) | undefined;
      const tx = {
        $queryRaw: vi.fn(async () => {
          releaseLock = await enterLock();
          return [{ id: 'campaign-1' }];
        }),
        payment: {
          updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = paymentState.get(where.id);
            if (!row || row.escrowReleasedAt !== null) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          }),
        },
        refund: { findMany: vi.fn(async () => []) },
        ledgerEntry: {
          count: vi.fn(async ({ where }: { where: { transactionId: string } }) =>
            rows.filter((r) => r.transactionId === where.transactionId).length,
          ),
          createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
            rows.push(...data);
            return { count: data.length };
          }),
        },
      };
      try {
        return await cb(tx);
      } finally {
        releaseLock?.();
      }
    });

    const [resultA, resultB] = await Promise.all([
      releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' }),
      releaseMaturedEscrow({ type: 'campaign', id: 'campaign-1' }),
    ]);

    // Exactly one of the two sweeps actually released it -- the other found
    // it already claimed and did nothing further.
    expect(resultA.releasedCount + resultB.releasedCount).toBe(1);

    const releaseLegs = rows.filter((r) => r.transactionId === 'escrow-release:payment-1');
    expect(releaseLegs).toHaveLength(2);
    const debits = releaseLegs.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    const credits = releaseLegs.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(credits);
    expect(debits).toBe(100_000);
  });
});

describe('releaseMaturedEscrow -- trip-linked payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases a matured Registration-linked payment into TRIP_BALANCE, locking VolunteerTrip not Campaign', async () => {
    const { rows, queryRawCalls } = makeDb([
      makePayment({ id: 'payment-1', amount: 100_000, campaignId: null, tripId: 'trip-1' }),
    ]);

    const result = await releaseMaturedEscrow({ type: 'trip', id: 'trip-1' });

    expect(result).toEqual({ releasedCount: 1, consideredCount: 1 });

    expect(queryRawCalls).toHaveLength(1);
    const lockQuery = queryRawCalls[0].join('');
    expect(lockQuery).toContain('VolunteerTrip');
    expect(lockQuery).not.toContain('Campaign');

    const releaseLegs = rows.filter((r) => r.transactionId === 'escrow-release:payment-1');
    expect(releaseLegs).toHaveLength(2);
    const debit = releaseLegs.find((r) => r.direction === 'DEBIT')!;
    const credit = releaseLegs.find((r) => r.direction === 'CREDIT')!;
    expect(debit).toMatchObject({ account: 'ESCROW_HOLD', amount: 100_000, volunteerTripId: 'trip-1' });
    expect(credit).toMatchObject({ account: 'TRIP_BALANCE', amount: 100_000, volunteerTripId: 'trip-1' });
    expect(debit.amount).toBe(credit.amount);
  });

  it('does not affect a Campaign-linked payment in the same sweep call -- both subjects processed correctly in one pass', async () => {
    const { rows } = makeDb([
      makePayment({ id: 'payment-campaign', amount: 100_000, campaignId: 'campaign-1', tripId: null }),
      makePayment({ id: 'payment-trip', amount: 50_000, campaignId: null, tripId: 'trip-1' }),
    ]);

    const result = await releaseMaturedEscrow();

    expect(result).toEqual({ releasedCount: 2, consideredCount: 2 });

    const campaignLegs = rows.filter((r) => r.transactionId === 'escrow-release:payment-campaign');
    expect(campaignLegs.find((r) => r.direction === 'CREDIT')).toMatchObject({
      account: 'CAMPAIGN_BALANCE',
      amount: 100_000,
      campaignId: 'campaign-1',
    });

    const tripLegs = rows.filter((r) => r.transactionId === 'escrow-release:payment-trip');
    expect(tripLegs.find((r) => r.direction === 'CREDIT')).toMatchObject({
      account: 'TRIP_BALANCE',
      amount: 50_000,
      volunteerTripId: 'trip-1',
    });
  });
});
