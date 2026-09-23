import { describe, it, expect, vi } from 'vitest';
import {
  createRefund,
  approveRefund,
  DemoCampaignError,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
  RefundNotFoundError,
  SelfApprovalError,
  InvalidRefundStatusError,
} from './refunds';

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    amount: 100_000,
    providerFee: 5_000,
    escrowReleasedAt: null as Date | null,
    donation: { campaignId: 'campaign-1' },
    registration: null as { batch: { tripId: string } } | null,
    ...overrides,
  };
}

function makeTripPayment(overrides: Record<string, unknown> = {}) {
  return makePayment({
    donation: null,
    registration: { batch: { tripId: 'trip-1' } },
    ...overrides,
  });
}

/**
 * Minimal in-memory stand-in for a Prisma transaction client, reusing the
 * same ledgerEntry.groupBy/createMany simulation as
 * src/lib/money/payouts.test.ts, so campaignBalance/tripBalance/
 * escrowBalance/tripEscrowBalance and postTransaction are exercised for
 * real rather than mocked away.
 */
function makeTx(
  options: {
    ledgerRows?: LedgerRow[];
    payment?: ReturnType<typeof makePayment> | null;
    isDemo?: boolean;
    priorRefunds?: Array<{ amount: number; status: string }>;
    refundRow?: Record<string, unknown> | null;
  } = {},
) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const payment = options.payment === undefined ? makePayment() : options.payment;
  const refundCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'refund-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedById: null,
    providerRef: null,
    ...data,
  }));
  const state = options.refundRow ? { ...options.refundRow } : null;
  const refundFindUnique = vi.fn().mockResolvedValue(state);
  const refundUpdateMany = vi.fn(
    async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
      if (!state || state.status !== where.status) return { count: 0 };
      Object.assign(state, data);
      return { count: 1 };
    },
  );
  const queryRawCalls: string[] = [];

  return {
    tx: {
      $queryRaw: vi.fn((strings: TemplateStringsArray) => {
        const text = strings.join('');
        queryRawCalls.push(text);
        if (text.includes('"Payment"')) {
          return Promise.resolve(payment ? [{ id: payment.id }] : []);
        }
        return Promise.resolve([{ id: 'locked' }]);
      }),
      payment: {
        findUniqueOrThrow: vi.fn(async () => payment),
      },
      campaign: { findUnique: vi.fn().mockResolvedValue({ isDemo: options.isDemo ?? false }) },
      refund: {
        create: refundCreate,
        findUnique: refundFindUnique,
        findMany: vi.fn().mockResolvedValue(options.priorRefunds ?? []),
        updateMany: refundUpdateMany,
      },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
          const filtered = rows.filter((r) => {
            const w = args.where ?? {};
            return Object.entries(w).every(([k, v]) => (r as never as Record<string, unknown>)[k] === v);
          });
          const buckets = new Map<string, { row: Record<string, unknown>; sum: number }>();
          for (const r of filtered) {
            const key = args.by.map((k) => String((r as never as Record<string, unknown>)[k])).join('|');
            const b = buckets.get(key) ?? {
              row: Object.fromEntries(args.by.map((k) => [k, (r as never as Record<string, unknown>)[k]])),
              sum: 0,
            };
            b.sum += r.amount;
            buckets.set(key, b);
          }
          return Array.from(buckets.values()).map((b) => ({ ...b.row, _sum: { amount: b.sum } }));
        }),
      },
    },
    refundCreate,
    rows,
    queryRawCalls,
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>['tx'], finalRow: Record<string, unknown>) {
  return {
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    refund: { findUniqueOrThrow: vi.fn().mockResolvedValue(finalRow) },
  };
}

describe('createRefund', () => {
  it('freezes funds from ESCROW_HOLD when the Payment has not matured, crediting FROZEN_BALANCE', async () => {
    const { tx, refundCreate, rows } = makeTx({ payment: makePayment({ escrowReleasedAt: null }) });

    const refund = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'Dibayar dua kali',
      requestedById: 'admin-1',
    });

    expect(refund.status).toBe('REQUESTED');
    expect(refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'payment-1', amount: 40_000, requestedById: 'admin-1', status: 'REQUESTED' }) }),
    );
    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 40_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 40_000, campaignId: 'campaign-1' }),
    ]);
  });

  it('freezes funds from CAMPAIGN_BALANCE once the Payment has matured', async () => {
    const { tx, rows } = makeTx({ payment: makePayment({ escrowReleasedAt: new Date('2026-01-01') }) });

    await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'x',
      requestedById: 'admin-1',
    });

    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted[0]).toMatchObject({ account: 'CAMPAIGN_BALANCE', direction: 'DEBIT' });
  });

  it('freezes funds from TRIP_BALANCE for a matured Trip subject, never touching CAMPAIGN_BALANCE', async () => {
    const { tx, rows } = makeTx({ payment: makeTripPayment({ escrowReleasedAt: new Date('2026-01-01') }) });

    await createRefund(tx as never, {
      subject: { type: 'trip', tripId: 'trip-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'x',
      requestedById: 'admin-1',
    });

    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted.some((r) => r.account === 'CAMPAIGN_BALANCE')).toBe(false);
    expect(posted[0]).toMatchObject({ account: 'TRIP_BALANCE', direction: 'DEBIT', volunteerTripId: 'trip-1', campaignId: null });
  });

  it('rejects a demo Campaign with DemoCampaignError before ever creating a Refund row', async () => {
    const { tx, refundCreate } = makeTx({ isDemo: true });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(DemoCampaignError);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('never runs the isDemo check for a Trip subject -- VolunteerTrip has no isDemo field', async () => {
    const { tx } = makeTx({ payment: makeTripPayment() });

    await createRefund(tx as never, { subject: { type: 'trip', tripId: 'trip-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' });

    expect(tx.campaign.findUnique).not.toHaveBeenCalled();
  });

  it('throws PaymentNotFoundError when the Payment row lock finds nothing', async () => {
    const { tx } = makeTx({ payment: null });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'missing', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(PaymentNotFoundError);
  });

  it('throws PaymentSubjectMismatchError when the Payment belongs to a different Campaign than the subject given', async () => {
    const { tx } = makeTx({ payment: makePayment({ donation: { campaignId: 'a-different-campaign' } }) });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(PaymentSubjectMismatchError);
  });

  it('throws PaymentSubjectMismatchError when the Payment is Campaign-linked but a Trip subject is given', async () => {
    const { tx } = makeTx({ payment: makePayment() });

    await expect(
      createRefund(tx as never, { subject: { type: 'trip', tripId: 'trip-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(PaymentSubjectMismatchError);
  });

  it('throws PaymentSubjectMismatchError when the Payment is Trip-linked but a Campaign subject is given', async () => {
    const { tx } = makeTx({ payment: makeTripPayment() });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(PaymentSubjectMismatchError);
  });

  it('subtracts every prior non-rejected/failed Refund from what is still refundable', async () => {
    const { tx, refundCreate } = makeTx({
      payment: makePayment({ amount: 100_000 }),
      priorRefunds: [{ amount: 40_000, status: 'REQUESTED' }],
    });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 65_000, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(RefundExceedsRemainingError);
    expect(refundCreate).not.toHaveBeenCalled();

    // Exactly the remaining 60_000 succeeds.
    await createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 60_000, reason: 'x', requestedById: 'admin-1' });
    expect(refundCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT count a REJECTED prior Refund against what is still refundable', async () => {
    const { tx, refundCreate } = makeTx({
      payment: makePayment({ amount: 100_000 }),
      priorRefunds: [{ amount: 90_000, status: 'REJECTED' }],
    });

    await createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 100_000, reason: 'x', requestedById: 'admin-1' });
    expect(refundCreate).toHaveBeenCalledTimes(1);
  });

  it('locks the Payment row before computing the remaining-refundable cap', async () => {
    const { tx, queryRawCalls } = makeTx();

    await createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' });

    expect(queryRawCalls.some((q) => q.includes('"Payment"') && q.includes('FOR UPDATE'))).toBe(true);
  });
});

describe('approveRefund', () => {
  const baseRefundRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'refund-1',
    paymentId: 'payment-1',
    amount: 40_000,
    reason: 'x',
    status: 'REQUESTED',
    requestedById: 'requester-1',
    approvedById: null,
    payment: makePayment(),
    ...overrides,
  });

  it('settles a full refund with zero fees cleanly: FROZEN_BALANCE debited the full amount, no PLATFORM_FEE/REFUND_COST legs', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 0 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED', approvedById: 'admin-1' });

    const result = await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    expect(result.status).toBe('APPROVED');
    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'REFUND_CLEARING', direction: 'CREDIT', amount: 100_000 }),
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'DEBIT', amount: 100_000, campaignId: 'campaign-1' }),
    ]);
    expect(posted.some((r) => r.account === 'PLATFORM_FEE')).toBe(false);
    expect(posted.some((r) => r.account === 'REFUND_COST')).toBe(false);
  });

  it('splits a full refund with a nonzero Provider Fee: FROZEN_BALANCE closes in full, REFUND_COST gets the fee, and the source pool is topped back up', async () => {
    // Gross 100_000, Provider Fee 5_000. The freeze debited ESCROW_HOLD the
    // full 100_000, but paymentSettledLegs only ever credited it the NET
    // 95_000 -- so settle-1 here is 95_000, the real NET credited, not the
    // Gross. refundApprovedLegs debits FROZEN_BALANCE 100_000 (closing the
    // freeze in full), debits REFUND_COST exactly 5_000 (the fee, not
    // double-counted), and credits ESCROW_HOLD back 5_000 so the pool ends
    // up exactly where it started (95_000 credited, 95_000 debited net).
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 95_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 5_000 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ direction: 'DEBIT', amount: 100_000 });
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ direction: 'DEBIT', amount: 5_000 });
    expect(posted.find((r) => r.account === 'REFUND_CLEARING')).toMatchObject({ direction: 'CREDIT', amount: 100_000 });
    expect(posted.find((r) => r.account === 'ESCROW_HOLD' && r.direction === 'CREDIT')).toMatchObject({ amount: 5_000 });
    const debitTotal = posted.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    const creditTotal = posted.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(105_000);
    const escrowRows = rows.filter((r) => r.account === 'ESCROW_HOLD' && r.campaignId === 'campaign-1');
    const escrowNet = escrowRows.reduce((s, r) => s + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);
    expect(escrowNet).toBe(0); // FROZEN_BALANCE's fee-share correction returns the source pool to exactly where it started
  });

  it('rounds the proportional Provider Fee UP on a partial refund', async () => {
    // Gross 100_000, Provider Fee 3_333, refunding half (50_000): the
    // proportional share is 3_333 * 50_000 / 100_000 = 1_666.5, rounded up
    // to 1_667 -- a known literal, not recomputed the same way as the code.
    // settle-1 credits the real NET (100_000 - 3_333 = 96_667), not the Gross.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 96_667, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 50_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 50_000, payment: makePayment({ amount: 100_000, providerFee: 3_333 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 1_667 });
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ amount: 50_000 });
    expect(posted.find((r) => r.account === 'ESCROW_HOLD' && r.direction === 'CREDIT')).toMatchObject({ amount: 1_667 });
  });

  it('folds a shortfall into REFUND_COST when the subject pool has gone negative from the freeze, never driving FROZEN_BALANCE debit below zero', async () => {
    // CAMPAIGN_BALANCE holds 10_000 after the freeze already debited it by
    // the full 100_000 Gross (net credited was 95_000, an 85_000 Payout
    // already went out): poolBalance = 95_000 - 85_000 - 100_000 = -90_000.
    // combinedFeePortion = 5_000 (provider fee only, platform fee is 0).
    // shortfall = min(max(0, 90_000 - 5_000), netPortion=95_000) = 85_000.
    // FROZEN_BALANCE debits the full 100_000 (closing it out). REFUND_COST =
    // 5_000 (fee) + 85_000 (real shortfall) = 90_000. The matching CREDIT
    // CAMPAIGN_BALANCE 90_000 brings the campaign's own balance from 10_000
    // (before this refund) down to exactly 0 -- its true 10_000 economic
    // stake in this refund, with the platform absorbing the other 90_000.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 95_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'payout-1', direction: 'DEBIT', amount: 85_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 100_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({
      amount: 100_000,
      payment: makePayment({ amount: 100_000, providerFee: 5_000, escrowReleasedAt: new Date('2026-01-01') }),
    });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ amount: 100_000 });
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 90_000 });
    expect(posted.find((r) => r.account === 'REFUND_CLEARING')).toMatchObject({ amount: 100_000 });
    expect(posted.find((r) => r.account === 'CAMPAIGN_BALANCE' && r.direction === 'CREDIT')).toMatchObject({ amount: 90_000 });
  });

  it('settles a Trip-linked refund debiting FROZEN_BALANCE with volunteerTripId, never touching a Campaign row', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makeTripPayment({ amount: 100_000, providerFee: 0 }) });
    const { tx, rows, queryRawCalls } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.some((r) => r.campaignId)).toBe(false);
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ volunteerTripId: 'trip-1' });
    expect(queryRawCalls.some((q) => q.includes('VolunteerTrip'))).toBe(true);
    expect(queryRawCalls.some((q) => q.includes('"Campaign"'))).toBe(false);
  });

  it('rounds up correctly even for amounts where naive float division would lose precision', async () => {
    // providerFee * refund.amount = 30_000_001 * 970_000_001 = 29_100_001_000_000_001,
    // not representable as a double -- Math.ceil(n/d) on floats silently
    // returns 29_100_001 instead of the correct 29_100_002.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 969_999_999, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 970_000_001, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 970_000_001, payment: makePayment({ amount: 1_000_000_000, providerFee: 30_000_001 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 29_100_002 });
  });

  it('refuses self-approval', async () => {
    const { tx } = makeTx({ refundRow: baseRefundRow({ requestedById: 'same-person' }) });
    const prisma = makePrisma(tx, baseRefundRow());

    await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'same-person' })).rejects.toThrow(SelfApprovalError);
  });

  it('throws RefundNotFoundError for a nonexistent Refund', async () => {
    const { tx } = makeTx({ refundRow: null });
    const prisma = makePrisma(tx, {});

    await expect(approveRefund(prisma as never, { refundId: 'missing', approvedById: 'admin-1' })).rejects.toThrow(RefundNotFoundError);
  });

  it('throws InvalidRefundStatusError when the Refund is already APPROVED, REJECTED, or FAILED', async () => {
    for (const status of ['APPROVED', 'REJECTED', 'FAILED']) {
      const { tx } = makeTx({ refundRow: baseRefundRow({ status }) });
      const prisma = makePrisma(tx, baseRefundRow({ status }));

      await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' })).rejects.toThrow(InvalidRefundStatusError);
    }
  });

  it('REGRESSION: a second concurrent approval loses the race and posts nothing', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx, rows } = makeTx({ ledgerRows, refundRow: baseRefundRow() });
    // Simulates another approval having already flipped this Refund's status
    // out of REQUESTED between this call's read and its write -- exactly
    // what a real database's WHERE-matched updateMany returns for the loser.
    tx.refund.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma(tx, baseRefundRow());

    await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' })).rejects.toThrow(InvalidRefundStatusError);
    expect(rows.filter((r) => r.transactionId === 'refund-approved-refund-1')).toHaveLength(0);
  });
});
