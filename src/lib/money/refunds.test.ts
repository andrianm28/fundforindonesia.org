import { describe, it, expect, vi } from 'vitest';
import { Kind } from '@/generated/prisma/client';
import {
  createRefund,
  approveRefund,
  completeRefund,
  DemoCampaignError,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
  RefundNotFoundError,
  RefundNotAllowedForKindError,
  RefundProofInvalidError,
  RefundDestinationInvalidError,
  SelfApprovalError,
  InvalidRefundStatusError,
  TwoPersonRuleError,
  OwnSubjectConflictError,
} from './refunds';
import { readRefundDonorAccountNumber } from '@/lib/contact-fields';
import { ledgerGroupBy } from '../../../tests/support/ledger-group-by';

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
    // 0 by default (prd-compliance 17): every existing test in this file
    // predates the Platform Fee and asserts on Provider-Fee-only math: it
    // must see the fee split unchanged.
    platformFee: 0,
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
 * The three reasons PRD §196 names as the only ones a Refund on a zakat, Wakaf
 * or Hibah Campaign may be for. Written out here as literals rather than
 * imported from the module under test: a test that read the list out of the
 * code it is checking would agree with it by construction and could never
 * catch a wrong phrase.
 */
const PRD_TECHNICAL_FAILURES = [
  'salah bayar',
  'bayar ganda',
  'dana masuk setelah Campaign ditutup',
] as const;

/**
 * Minimal in-memory stand-in for a Prisma transaction client, using the shared
 * ledgerEntry.groupBy/createMany simulation
 * (tests/support/ledger-group-by.ts), so campaignBalance/tripBalance/
 * escrowBalance/tripEscrowBalance and postTransaction are exercised for
 * real rather than mocked away.
 */
function makeTx(
  options: {
    ledgerRows?: LedgerRow[];
    payment?: ReturnType<typeof makePayment> | null;
    isDemo?: boolean;
    /** The Campaign's stored status, which the subject guard turns into its effective status. */
    lifecycleStatus?: string;
    campaignCreatorId?: string;
    tripFundraiserId?: string;
    priorRefunds?: Array<{ amount: number; status: string }>;
    refundRow?: Record<string, unknown> | null;
    /** The Campaign's Kind, which the per-Kind Refund rule reads. */
    kind?: Kind;
  } = {},
) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const payment = options.payment === undefined ? makePayment() : options.payment;
  // Dynamic refund tracking, used when `options.priorRefunds` is NOT given:
  // `refund.create` records what it created, and `refund.findMany` replays
  // it back filtered/sorted the way the real query shape expects -- this is
  // what lets two sequential createRefund calls in the same test see each
  // other via the cumulative-refund-cap and cumulative-fee-cap checks.
  // Tests that pass `options.priorRefunds` explicitly keep the old static
  // behavior (`findMany` always returns exactly that array), unaffected.
  const dynamicRefunds: Array<{ id: string; paymentId: string; amount: number; status: string; createdAt: Date }> = [];
  let refundCounter = 0;
  const refundCreate = vi.fn(
    async ({ data }: { data: { paymentId: string; amount: number; status: string; reason: string; requestedById: string } }) => {
      refundCounter += 1;
      const row = {
        id: `refund-${refundCounter}`,
        createdAt: new Date(2026, 0, 1, 0, 0, refundCounter),
        updatedAt: new Date(),
        approvedById: null,
        providerRef: null,
        ...data,
      };
      dynamicRefunds.push(row);
      return row;
    },
  );
  const state = options.refundRow ? { ...options.refundRow } : null;
  const refundFindUnique = vi.fn().mockResolvedValue(state);
  const refundUpdateMany = vi.fn(
    async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
      if (!state || state.status !== where.status) return { count: 0 };
      Object.assign(state, data);
      return { count: 1 };
    },
  );
  const refundFindMany = vi.fn(
    async ({ where }: { where: { paymentId?: string; status?: { notIn: string[] }; createdAt?: { lt: Date } } } = { where: {} }) => {
      if (options.priorRefunds !== undefined) {
        return options.priorRefunds;
      }
      return dynamicRefunds
        .filter((r) => !where?.paymentId || r.paymentId === where.paymentId)
        .filter((r) => !where?.status || !where.status.notIn.includes(r.status))
        .filter((r) => !where?.createdAt || r.createdAt < where.createdAt.lt)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((r) => ({ amount: r.amount, status: r.status }));
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
      campaign: {
        findUnique: vi.fn().mockResolvedValue({
          isDemo: options.isDemo ?? false,
          creatorId: options.campaignCreatorId ?? 'fundraiser-1',
          lifecycleStatus: options.lifecycleStatus ?? 'ACTIVE',
          // Every test that does not name a Kind gets DONATION explicitly,
          // rather than leaving it undefined: a missing Kind must never be
          // what makes a per-Kind rule pass unnoticed.
          kind: options.kind ?? Kind.DONATION,
          deadline: null,
        }),
      },
      // The Trip row the subject guard reads under its lock.
      volunteerTrip: {
        findUnique: vi.fn().mockResolvedValue({ fundraiserId: options.tripFundraiserId ?? 'trip-fundraiser-1', status: 'ACTIVE' }),
      },
      refund: {
        create: refundCreate,
        findUnique: refundFindUnique,
        findMany: refundFindMany,
        updateMany: refundUpdateMany,
      },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(ledgerGroupBy(rows)),
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
  it('freezes funds from ESCROW_HOLD when the Payment has not matured, crediting FROZEN_BALANCE and splitting out the Provider Fee share at freeze time', async () => {
    const { tx, refundCreate, rows } = makeTx({ payment: makePayment({ escrowReleasedAt: null, amount: 100_000, providerFee: 5_000 }) });

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
    // providerFeePortionFor(payment, 40_000, []) = ceilMulDiv(5_000, 40_000, 100_000) = 2_000 exactly.
    // netPortion = 40_000 - 2_000 = 38_000 -- the freeze debits ESCROW_HOLD
    // only this NET share, never the full 40_000 Gross.
    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 40_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 38_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ account: 'REFUND_COST', direction: 'DEBIT', amount: 2_000 }),
    ]);
  });

  it('splits out the Platform Fee share too, alongside the Provider Fee, at freeze time (prd-compliance 17)', async () => {
    // Gross 100_000, Provider Fee 5_000, Platform Fee 2_500 -- both were
    // removed from the pool at Settlement (paymentSettledLegs), so both
    // must come back out of a Refund's net portion the same way.
    const { tx, rows } = makeTx({
      payment: makePayment({ escrowReleasedAt: null, amount: 100_000, providerFee: 5_000, platformFee: 2_500 }),
    });

    await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'Dibayar dua kali',
      requestedById: 'admin-1',
    });

    // providerFeePortionFor = ceilMulDiv(5_000, 40_000, 100_000) = 2_000.
    // platformFeePortionFor = ceilMulDiv(2_500, 40_000, 100_000) = 1_000.
    // netPortion = 40_000 - 2_000 - 1_000 = 37_000.
    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 40_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 37_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ account: 'PLATFORM_FEE', direction: 'DEBIT', amount: 1_000 }),
      expect.objectContaining({ account: 'REFUND_COST', direction: 'DEBIT', amount: 2_000 }),
    ]);
    const debits = posted.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    const credits = posted.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(credits);
  });

  it('still freezes a Refund on a Suspended Campaign: a Suspension freezes Payouts, not Refunds (PRD section 7.2)', async () => {
    const { tx, rows } = makeTx({ lifecycleStatus: 'SUSPENDED', payment: makePayment({ escrowReleasedAt: null }) });

    const refund = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'Campaign dibekukan',
      requestedById: 'admin-1',
    });

    expect(refund.status).toBe('REQUESTED');
    expect(rows.filter((r) => r.transactionId === 'refund-requested-refund-1')).toContainEqual(
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 40_000, campaignId: 'campaign-1' }),
    );
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
    expect(posted.find((r) => r.account === 'CAMPAIGN_BALANCE')).toMatchObject({ direction: 'DEBIT' });
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
    expect(posted.find((r) => r.account === 'TRIP_BALANCE')).toMatchObject({ direction: 'DEBIT', volunteerTripId: 'trip-1', campaignId: null });
  });

  it('rounds the proportional Provider Fee UP on a single partial refund, at freeze time', async () => {
    // Gross 100_000, Provider Fee 3_333, refunding half (50_000): the
    // proportional share is 3_333 * 50_000 / 100_000 = 1_666.5, rounded up
    // to 1_667 -- a known literal, not recomputed the same way as the code.
    const { tx, rows } = makeTx({ payment: makePayment({ amount: 100_000, providerFee: 3_333 }) });

    await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 50_000,
      reason: 'x',
      requestedById: 'admin-1',
    });

    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 1_667 });
    expect(posted.find((r) => r.account === 'ESCROW_HOLD')).toMatchObject({ amount: 48_333 });
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ amount: 50_000 });
  });

  it('rounds up correctly even for amounts where naive float division would lose precision', async () => {
    // providerFee * amount = 30_000_001 * 970_000_001 = 29_100_001_000_000_001,
    // not representable as a double -- Math.ceil(n/d) on floats silently
    // returns 29_100_001 instead of the correct 29_100_002.
    const { tx, rows } = makeTx({ payment: makePayment({ amount: 1_000_000_000, providerFee: 30_000_001 }) });

    await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 970_000_001,
      reason: 'x',
      requestedById: 'admin-1',
    });

    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 29_100_002 });
  });

  it('rejects a demo Campaign with DemoCampaignError before ever creating a Refund row', async () => {
    const { tx, refundCreate } = makeTx({ isDemo: true });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(DemoCampaignError);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('refuses an ordinary donor request on a zakat Campaign, before any Refund row and before any freeze leg (PRD 196, ADR 0013)', async () => {
    // The seeded reachability shape (prisma/seed.ts): an Active zakat Campaign
    // with a settled Payment of real rupiah behind it, and an Admin -- the only
    // actor who can reach this -- typing an ordinary request into a free-text
    // reason. Before the per-Kind rule this froze Rp 1_000_000 out of the pool.
    const { tx, refundCreate, rows } = makeTx({
      kind: Kind.ZAKAT,
      payment: makePayment({ amount: 1_000_000, escrowReleasedAt: null }),
    });

    const attempt = createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 1_000_000,
      reason: 'Permintaan donatur',
      requestedById: 'admin-1',
    });

    await expect(attempt).rejects.toThrow(RefundNotAllowedForKindError);
    expect(refundCreate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it.each([Kind.WAKAF, Kind.HIBAH])(
    'reads the same rule for %s: an ordinary donor request is refused there too (ADR 0013: one rule, not a rule each)',
    async (kind) => {
      const { tx, refundCreate, rows } = makeTx({
        kind,
        payment: makePayment({ amount: 1_000_000, escrowReleasedAt: null }),
      });

      await expect(
        createRefund(tx as never, {
          subject: { type: 'campaign', campaignId: 'campaign-1' },
          paymentId: 'payment-1',
          amount: 1_000_000,
          reason: 'Permintaan donatur',
          requestedById: 'admin-1',
        }),
      ).rejects.toThrow(RefundNotAllowedForKindError);
      expect(refundCreate).not.toHaveBeenCalled();
      expect(rows).toHaveLength(0);
    },
  );

  it.each(
    [Kind.ZAKAT, Kind.WAKAF, Kind.HIBAH].flatMap((kind) =>
      PRD_TECHNICAL_FAILURES.map((reason) => [kind, reason] as const),
    ),
  )('permits a Refund on a %s Campaign whose reason is exactly the technical failure "%s" (PRD 196)', async (kind, reason) => {
    const { tx, refundCreate, rows } = makeTx({
      kind,
      payment: makePayment({ amount: 1_000_000, escrowReleasedAt: null }),
    });

    const refund = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 1_000_000,
      reason,
      requestedById: 'admin-1',
    });

    expect(refund.status).toBe('REQUESTED');
    expect(refundCreate).toHaveBeenCalledTimes(1);
    expect(rows.filter((r) => r.account === 'FROZEN_BALANCE')).toHaveLength(1);
  });

  it.each([
    // A misspelling of a carve-out. The point of comparing whole phrases
    // rather than looking for a word inside the text: a keyword search would
    // read "salah byar" as close enough, and a gate that can be passed by
    // misspelling is the same class of hole as no gate at all.
    'salah byar',
    'salahbayar',
    'salah bay',
    'bayar gande',
    'dana masuk setelah campaign di*tutup',
    // The same failure wrapped in a sentence, and the ordinary request with
    // the magic words appended -- what a substring or "contains a keyword"
    // match would wave through, and what a person trying to get a refund
    // through would actually type.
    'Donor salah bayar',
    'Permintaan donatur, tetapi salah bayar',
    'salah bayar (permintaan donatur)',
    // Punctuation and doubled spaces are not a carve-out either.
    'salah bayar.',
    'salah  bayar',
    // A truthful description of the double payment that is NOT PRD 196's
    // wording -- and the phrasing this very file used before the rule
    // existed. It is refused, which is the honest cost of a free-text
    // reason: a real technical failure can be worded this way and still
    // stopped. See the note on requireRefundAllowedForKind.
    'Dibayar dua kali',
  ])('refuses a zakat reason that only resembles a technical failure: "%s"', async (reason) => {
    const { tx, refundCreate, rows } = makeTx({
      kind: Kind.ZAKAT,
      payment: makePayment({ amount: 1_000_000, escrowReleasedAt: null }),
    });

    await expect(
      createRefund(tx as never, {
        subject: { type: 'campaign', campaignId: 'campaign-1' },
        paymentId: 'payment-1',
        amount: 1_000_000,
        reason,
        requestedById: 'admin-1',
      }),
    ).rejects.toThrow(RefundNotAllowedForKindError);
    expect(refundCreate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('ignores capitalisation and surrounding spaces on a genuine technical failure, so the leniency never costs a real refund', async () => {
    const { tx, refundCreate } = makeTx({
      kind: Kind.ZAKAT,
      payment: makePayment({ amount: 1_000_000, escrowReleasedAt: null }),
    });

    const refund = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 1_000_000,
      reason: '  Salah Bayar  ',
      requestedById: 'admin-1',
    });

    expect(refund.status).toBe('REQUESTED');
    expect(refundCreate).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary donation Campaign alone: the rule is per-Kind, not a blanket freeze on refunds', async () => {
    const { tx, refundCreate, rows } = makeTx({
      kind: Kind.DONATION,
      payment: makePayment({ amount: 1_000_000, escrowReleasedAt: null }),
    });

    const refund = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 1_000_000,
      reason: 'Permintaan donatur',
      requestedById: 'admin-1',
    });

    expect(refund.status).toBe('REQUESTED');
    expect(refundCreate).toHaveBeenCalledTimes(1);
    expect(rows.filter((r) => r.account === 'FROZEN_BALANCE')).toHaveLength(1);
  });

  it('refuses an Admin who is the Campaign\'s own Fundraiser: no Refund row, no freeze legs', async () => {
    const { tx, refundCreate, rows } = makeTx({ campaignCreatorId: 'admin-1' });

    const attempt = createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'x',
      requestedById: 'admin-1',
    });

    await expect(attempt).rejects.toThrow(OwnSubjectConflictError);
    await expect(attempt).rejects.toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT', message: expect.stringContaining('harus dilakukan Admin lain') });
    expect(refundCreate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('lets the Trip\'s own Fundraiser create a Trip Refund -- Batch cancellation does exactly this, outside any Admin capacity', async () => {
    const { tx, refundCreate } = makeTx({ payment: makeTripPayment() });

    const refund = await createRefund(tx as never, {
      subject: { type: 'trip', tripId: 'trip-1' },
      paymentId: 'payment-1',
      amount: 1,
      reason: 'Batch dibatalkan',
      requestedById: 'trip-fundraiser-1',
    });

    expect(refund.status).toBe('REQUESTED');
    expect(refundCreate).toHaveBeenCalled();
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

  it('still approves a Refund on a Suspended Campaign (PRD section 7.2)', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 0 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow, lifecycleStatus: 'SUSPENDED' });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED', approvedById: 'admin-1' });

    const result = await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    expect(result.status).toBe('APPROVED');
    expect(rows.filter((r) => r.transactionId === 'refund-approved-refund-1')).toContainEqual(
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'DEBIT', amount: 100_000, campaignId: 'campaign-1' }),
    );
  });

  it('settles a full refund with a nonzero Provider Fee cleanly at approval, since the fee was already split out at freeze time', async () => {
    // Gross 100_000, Provider Fee 5_000. The freeze (createRefund, tested
    // separately above) already debited ESCROW_HOLD only the refund's own
    // 95_000 NET share and posted REFUND_COST 5_000 THERE, in the
    // "refund-requested-..." transaction -- so settle-1 (95_000, the real
    // NET credited) and freeze-1 (95_000, this refund's own net share) net
    // the pool to exactly 0. Approval must NOT re-split or re-post the fee:
    // it only closes FROZEN_BALANCE and credits the donor the full Gross.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 95_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 95_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 5_000 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'REFUND_CLEARING', direction: 'CREDIT', amount: 100_000 }),
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'DEBIT', amount: 100_000, campaignId: 'campaign-1' }),
    ]);
    expect(posted.some((r) => r.account === 'REFUND_COST')).toBe(false);
    expect(posted.some((r) => r.account === 'ESCROW_HOLD')).toBe(false);
    const escrowRows = rows.filter((r) => r.account === 'ESCROW_HOLD' && r.campaignId === 'campaign-1');
    const escrowNet = escrowRows.reduce((s, r) => s + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);
    expect(escrowNet).toBe(0); // the freeze's own net-share debit is all it took; nothing left stranded, nothing double-posted
  });

  it('settles a full refund with a nonzero Platform Fee cleanly at approval, alongside the Provider Fee (prd-compliance 17)', async () => {
    // Gross 100_000, Provider Fee 5_000, Platform Fee 2_500. The freeze
    // already debited ESCROW_HOLD only the refund's own 92_500 NET share
    // (100_000 - 5_000 - 2_500) and posted REFUND_COST 5_000 and
    // PLATFORM_FEE 2_500 in the "refund-requested-..." transaction -- so
    // settle-1 (92_500) and freeze-1 (92_500) net the pool to exactly 0.
    // Approval must not re-split or re-post either fee.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 92_500, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 92_500, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({
      amount: 100_000,
      payment: makePayment({ amount: 100_000, providerFee: 5_000, platformFee: 2_500 }),
    });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'REFUND_CLEARING', direction: 'CREDIT', amount: 100_000 }),
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'DEBIT', amount: 100_000, campaignId: 'campaign-1' }),
    ]);
    expect(posted.some((r) => r.account === 'REFUND_COST' || r.account === 'PLATFORM_FEE')).toBe(false);
    const escrowRows = rows.filter((r) => r.account === 'ESCROW_HOLD' && r.campaignId === 'campaign-1');
    const escrowNet = escrowRows.reduce((s, r) => s + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);
    expect(escrowNet).toBe(0); // nothing stranded, nothing double-posted
  });

  it('settles a partial refund with a nonzero Provider Fee cleanly at approval, mirroring the full-refund case', async () => {
    // Gross 100_000, Provider Fee 3_333, refunding half (50_000). The freeze
    // already debited ESCROW_HOLD only 48_333 (50_000 - 1_667, its own
    // rounded-up NET share) and posted REFUND_COST 1_667 there. settle-1
    // credits the real NET (96_667), freeze-1 debits this refund's own
    // 48_333 net share -- pool stays healthy (48_334), so approval posts
    // only the simple 2-leg settlement.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 96_667, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 48_333, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 50_000, payment: makePayment({ amount: 100_000, providerFee: 3_333 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'REFUND_CLEARING', direction: 'CREDIT', amount: 50_000 }),
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'DEBIT', amount: 50_000, campaignId: 'campaign-1' }),
    ]);
    expect(posted.some((r) => r.account === 'REFUND_COST')).toBe(false);
  });

  it('folds a genuine shortfall into REFUND_COST when the subject pool has gone negative beyond the (already-handled) fee, never driving FROZEN_BALANCE debit below zero', async () => {
    // Gross 100_000, Provider Fee 5_000, matured (source = CAMPAIGN_BALANCE).
    // The freeze already debited CAMPAIGN_BALANCE only its own 95_000 NET
    // share (100_000 - 5_000). settle-1 credited 95_000 (the real NET), an
    // 85_000 Payout already went out: poolBalance = 95_000 - 85_000 - 95_000
    // = -85_000. netPortion = 100_000 - 0 - 5_000 = 95_000 (providerFeePortion
    // recomputed identically to freeze time, since Payment fields and prior
    // refunds are unchanged). shortfall = min(max(0, 85_000), 95_000) =
    // 85_000 -- genuine insolvency, not a fee artifact (the fee was already
    // handled at freeze time, so it plays no part in this shortfall at all).
    // FROZEN_BALANCE debits the full 100_000 (closing it out). REFUND_COST =
    // 85_000. The matching CREDIT CAMPAIGN_BALANCE 85_000 brings the
    // campaign's own balance from -85_000 back to exactly 0 -- the platform
    // absorbing the shortfall, not the fee (already absorbed at freeze).
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 95_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'payout-1', direction: 'DEBIT', amount: 85_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 95_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
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
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 85_000 });
    expect(posted.find((r) => r.account === 'REFUND_CLEARING')).toMatchObject({ amount: 100_000 });
    expect(posted.find((r) => r.account === 'CAMPAIGN_BALANCE' && r.direction === 'CREDIT')).toMatchObject({ amount: 85_000 });
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

  it('refuses self-approval, posting no ledger entries', async () => {
    const { tx, rows } = makeTx({ refundRow: baseRefundRow({ requestedById: 'same-person' }) });
    const prisma = makePrisma(tx, baseRefundRow());

    await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'same-person' })).rejects.toThrow(SelfApprovalError);
    expect(rows).toHaveLength(0);
  });

  it('refuses an Admin who is the Campaign\'s own Fundraiser, leaving the Refund REQUESTED and posting nothing', async () => {
    const refundRow = baseRefundRow({ payment: makePayment() });
    const { tx, rows } = makeTx({ refundRow, campaignCreatorId: 'admin-1' });
    const prisma = makePrisma(tx, refundRow);

    const attempt = approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    await expect(attempt).rejects.toThrow(OwnSubjectConflictError);
    await expect(attempt).rejects.toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT', message: expect.stringContaining('harus dilakukan Admin lain') });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('refuses an Admin who is the Volunteer Trip\'s own Fundraiser, leaving the Refund REQUESTED and posting nothing', async () => {
    const refundRow = baseRefundRow({ payment: makeTripPayment() });
    const { tx, rows } = makeTx({ refundRow, tripFundraiserId: 'admin-1' });
    const prisma = makePrisma(tx, refundRow);

    const attempt = approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    await expect(attempt).rejects.toThrow(OwnSubjectConflictError);
    await expect(attempt).rejects.toMatchObject({ code: 'OWN_TRIP_CONFLICT', message: expect.stringContaining('harus dilakukan Admin lain') });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('throws RefundNotFoundError for a nonexistent Refund, posting no ledger entries', async () => {
    const { tx, rows } = makeTx({ refundRow: null });
    const prisma = makePrisma(tx, {});

    await expect(approveRefund(prisma as never, { refundId: 'missing', approvedById: 'admin-1' })).rejects.toThrow(RefundNotFoundError);
    expect(rows).toHaveLength(0);
  });

  it('throws InvalidRefundStatusError when the Refund is already APPROVED, REJECTED, or FAILED, posting no ledger entries', async () => {
    for (const status of ['APPROVED', 'REJECTED', 'FAILED']) {
      const { tx, rows } = makeTx({ refundRow: baseRefundRow({ status }) });
      const prisma = makePrisma(tx, baseRefundRow({ status }));

      await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' })).rejects.toThrow(InvalidRefundStatusError);
      expect(rows).toHaveLength(0);
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

/**
 * A fuller in-memory Prisma stand-in supporting MULTIPLE Payments and
 * MULTIPLE Refunds, unlike `makeTx` above (one fixed Payment, one Refund
 * row at most) -- needed for the two-refunds-on-one-pool and
 * cumulative-fee-cap regressions below, which drive createRefund/
 * approveRefund through real sequences of calls rather than asserting a
 * single call's output against a hand-set-up snapshot.
 */
function makeMultiPaymentTx(initialLedgerRows: LedgerRow[] = []) {
  const rows: LedgerRow[] = [...initialLedgerRows];
  const payments = new Map<string, ReturnType<typeof makePayment>>();
  const refunds = new Map<string, Record<string, unknown>>();
  let refundCounter = 0;
  const queryRawCalls: string[] = [];

  const tx = {
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('');
      queryRawCalls.push(text);
      if (text.includes('"Payment"')) {
        const id = values[0] as string;
        return Promise.resolve(payments.has(id) ? [{ id }] : []);
      }
      return Promise.resolve([{ id: 'locked' }]);
    }),
    payment: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => payments.get(where.id)),
    },
    campaign: {
      // DONATION explicitly, as in makeTx: this harness's scenarios are all
      // ordinary-donation refunds, and leaving the Kind off the row would have
      // the per-Kind rule refuse them for a reason that has nothing to do with
      // what they are testing.
      findUnique: vi.fn().mockResolvedValue({ isDemo: false, creatorId: 'fundraiser-1', lifecycleStatus: 'ACTIVE', kind: Kind.DONATION, deadline: null }),
    },
    refund: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        refundCounter += 1;
        const row = {
          id: `refund-${refundCounter}`,
          createdAt: new Date(2026, 0, 1, 0, 0, refundCounter),
          updatedAt: new Date(),
          approvedById: null,
          providerRef: null,
          ...data,
        };
        refunds.set(row.id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = refunds.get(where.id);
        if (!row) return null;
        return { ...row, payment: payments.get(row.paymentId as string) };
      }),
      findMany: vi.fn(
        async ({ where }: { where: { paymentId?: string; status?: { notIn: string[] }; createdAt?: { lt: Date } } }) =>
          Array.from(refunds.values())
            .filter((r) => !where.paymentId || r.paymentId === where.paymentId)
            .filter((r) => !where.status || !where.status.notIn.includes(r.status as string))
            .filter((r) => !where.createdAt || (r.createdAt as Date) < where.createdAt.lt)
            .sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime())
            .map((r) => ({ amount: r.amount, status: r.status })),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const row = refunds.get(where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    ledgerEntry: {
      count: vi.fn(async () => 0),
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        rows.push(...data);
        return { count: data.length };
      }),
      groupBy: vi.fn(ledgerGroupBy(rows)),
    },
  };

  const prisma = {
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    refund: { findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => refunds.get(where.id)) },
  };

  return { tx, prisma, rows, payments, queryRawCalls };
}

function escrowNetOf(rows: LedgerRow[], campaignId: string): number {
  return rows
    .filter((r) => r.account === 'ESCROW_HOLD' && r.campaignId === campaignId)
    .reduce((s, r) => s + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);
}

describe('settlement redesign regressions (freeze splits the fee, not settlement)', () => {
  it('SCENARIO A: two refunds pending on the same campaign pool both settle without phantom balance or double-counted fee', async () => {
    // Two Payments, each Gross 100_000 / Provider Fee 5_000, both settled to
    // the same campaign's ESCROW_HOLD (net 95_000 each). A full Refund is
    // requested against EACH payment before either is approved -- the
    // scenario that broke the prior (settlement-time fee-split) design: with
    // this one shared pool, approving the first refund used to misread the
    // second's still-pending freeze over-draw as "shortfall" and top up
    // money that was never actually missing.
    const { tx, prisma, rows, payments } = makeMultiPaymentTx([
      { transactionId: 'settle-a', direction: 'CREDIT', amount: 95_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'settle-b', direction: 'CREDIT', amount: 95_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ]);
    payments.set('payment-a', makePayment({ id: 'payment-a', amount: 100_000, providerFee: 5_000 }));
    payments.set('payment-b', makePayment({ id: 'payment-b', amount: 100_000, providerFee: 5_000 }));

    const refundA = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-a',
      amount: 100_000,
      reason: 'x',
      requestedById: 'admin-1',
    });
    const refundB = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-b',
      amount: 100_000,
      reason: 'x',
      requestedById: 'admin-1',
    });

    // Each freeze debited only its own 95_000 NET share -- the pool lands on
    // exactly 0, not negative (190_000 credited - 95_000 - 95_000 debited).
    expect(escrowNetOf(rows, 'campaign-1')).toBe(0);

    await approveRefund(prisma as never, { refundId: refundA.id, approvedById: 'admin-2' });
    await approveRefund(prisma as never, { refundId: refundB.id, approvedById: 'admin-2' });

    // Neither settlement should have posted a phantom top-up: the pool was
    // never over-drawn by a fee in the first place, so there is nothing to
    // correct here (shortfall is 0 for both).
    expect(escrowNetOf(rows, 'campaign-1')).toBe(0);
    const refundCostTotal = rows.filter((r) => r.account === 'REFUND_COST').reduce((s, r) => s + r.amount, 0);
    expect(refundCostTotal).toBe(10_000); // 5_000 + 5_000 -- the true total fee cost, never 15_000+
    const settlementLegsA = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    const settlementLegsB = rows.filter((r) => r.transactionId === 'refund-approved-refund-2');
    expect(settlementLegsA.every((r) => r.account !== 'REFUND_COST')).toBe(true);
    expect(settlementLegsB.every((r) => r.account !== 'REFUND_COST')).toBe(true);
  });

  it('SCENARIO C: two sequential 50_000 partial refunds on the same Payment cap their cumulative Provider Fee at the Payment total, never over-recognizing from independent rounding', async () => {
    // Gross 100_000, Provider Fee 3_333. Each 50_000 partial's OWN
    // proportional share independently rounds 1_666.5 up to 1_667 -- taken
    // naively, twice, that recognizes 3_334 total, one rupiah more than the
    // Payment ever actually paid the provider. providerFeePortionFor caps
    // the second refund's portion against what the first already claimed.
    const { tx, rows } = makeTx({ payment: makePayment({ amount: 100_000, providerFee: 3_333 }) });

    const refund1 = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 50_000,
      reason: 'x',
      requestedById: 'admin-1',
    });
    const refund2 = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 50_000,
      reason: 'x',
      requestedById: 'admin-1',
    });

    const posted1 = rows.filter((r) => r.transactionId === `refund-requested-${refund1.id}`);
    const posted2 = rows.filter((r) => r.transactionId === `refund-requested-${refund2.id}`);
    expect(posted1.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 1_667 });
    expect(posted2.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 1_666 });
    const totalFeeRecognized = [...posted1, ...posted2]
      .filter((r) => r.account === 'REFUND_COST')
      .reduce((s, r) => s + r.amount, 0);
    expect(totalFeeRecognized).toBe(3_333); // exactly the Payment's real total fee, never 3_334
  });
});

describe('completeRefund', () => {
  const baseApprovedRefundRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'refund-1',
    paymentId: 'payment-1',
    amount: 100_000,
    reason: 'x',
    status: 'APPROVED',
    requestedById: 'requester-1',
    approvedById: 'approver-1',
    payment: makePayment({ amount: 100_000, providerFee: 0 }),
    ...overrides,
  });

  const validProof = {
    proofReference: 'TRX-refund-1',
    proofNote: 'Ditransfer via mobile banking BCA, dicocokkan dengan nama dan rekening Donor.',
  };
  const validDestination = {
    donorBankCode: 'BCA',
    donorAccountName: 'Budi Santoso',
    donorAccountNumber: '1234567890',
  };

  it('completes an APPROVED refund by a third Admin, posting DEBIT REFUND_CLEARING / CREDIT GATEWAY_CLEARING for the full Gross', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx, rows } = makeTx({ refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'COMPLETED', completedById: 'completer-1' });

    const result = await completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validDestination,
    });

    expect(result.status).toBe('COMPLETED');
    const posted = rows.filter((r) => r.transactionId === 'refund-completed-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'REFUND_CLEARING', direction: 'DEBIT', amount: 100_000, campaignId: null, volunteerTripId: null }),
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 100_000, campaignId: null, volunteerTripId: null }),
    ]);
  });

  it('records completedById, completedAt, the joined proof, the plaintext bank code/name, and a sealed donor account number that decrypts back to what was typed', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'COMPLETED' });

    await completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validDestination,
    });

    expect(tx.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'refund-1', status: 'APPROVED' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          completedById: 'completer-1',
          completedAt: expect.any(Date),
          proofImage: 'TRX-refund-1 — Ditransfer via mobile banking BCA, dicocokkan dengan nama dan rekening Donor.',
          donorBankCode: 'BCA',
          donorAccountName: 'Budi Santoso',
        }),
      }),
    );
    const call = (tx.refund.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const written = call.data as Record<string, unknown>;
    // Sealed, never the plaintext number itself, on the row this writes.
    expect(written.donorAccountNumberCiphertext).toEqual(expect.any(String));
    expect(written.donorAccountNumberCiphertext).not.toBe('1234567890');
    expect(
      readRefundDonorAccountNumber({
        donorAccountNumberCiphertext: written.donorAccountNumberCiphertext as string,
        donorAccountNumberKeyId: written.donorAccountNumberKeyId as string,
      }),
    ).toBe('1234567890');
  });

  it('refuses the Admin who REQUESTED this Refund, posting nothing', async () => {
    const refundRow = baseApprovedRefundRow({ requestedById: 'same-person' });
    const { tx, rows } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'same-person',
      ...validProof,
      ...validDestination,
    });

    await expect(attempt).rejects.toThrow(TwoPersonRuleError);
    await expect(attempt).rejects.toMatchObject({ code: 'TWO_PERSON_RULE' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('refuses the Admin who APPROVED this Refund, posting nothing (mirrors completePayout)', async () => {
    const refundRow = baseApprovedRefundRow({ approvedById: 'same-person' });
    const { tx, rows } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'same-person',
      ...validProof,
      ...validDestination,
    });

    await expect(attempt).rejects.toThrow(TwoPersonRuleError);
    await expect(attempt).rejects.toMatchObject({ code: 'TWO_PERSON_RULE' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('refuses a Refund that is not APPROVED (still REQUESTED), posting nothing', async () => {
    const refundRow = baseApprovedRefundRow({ status: 'REQUESTED' });
    const { tx, rows } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    await expect(
      completeRefund(prisma as never, { refundId: 'refund-1', completedById: 'completer-1', ...validProof, ...validDestination }),
    ).rejects.toThrow(InvalidRefundStatusError);
    expect(rows).toHaveLength(0);
  });

  it("refuses an Admin who is the Campaign's own Fundraiser, posting nothing", async () => {
    const refundRow = baseApprovedRefundRow({ payment: makePayment() });
    const { tx, rows } = makeTx({ refundRow, campaignCreatorId: 'completer-1' });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validDestination,
    });

    await expect(attempt).rejects.toThrow(OwnSubjectConflictError);
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('refuses a blank proof reference before opening any transaction', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    await expect(
      completeRefund(prisma as never, {
        refundId: 'refund-1',
        completedById: 'completer-1',
        proofReference: '   ',
        proofNote: validProof.proofNote,
        ...validDestination,
      }),
    ).rejects.toThrow(RefundProofInvalidError);
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a blank proof note', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    await expect(
      completeRefund(prisma as never, {
        refundId: 'refund-1',
        completedById: 'completer-1',
        proofReference: validProof.proofReference,
        proofNote: '',
        ...validDestination,
      }),
    ).rejects.toThrow(RefundProofInvalidError);
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a blank donor bank code, naming the field', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validDestination,
      donorBankCode: '  ',
    });

    await expect(attempt).rejects.toThrow(RefundDestinationInvalidError);
    await expect(attempt).rejects.toMatchObject({ field: 'donorBankCode' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a blank donor account name, naming the field', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validDestination,
      donorAccountName: '',
    });

    await expect(attempt).rejects.toThrow(RefundDestinationInvalidError);
    await expect(attempt).rejects.toMatchObject({ field: 'donorAccountName' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a blank donor account number, naming the field', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validDestination,
      donorAccountNumber: '',
    });

    await expect(attempt).rejects.toThrow(RefundDestinationInvalidError);
    await expect(attempt).rejects.toMatchObject({ field: 'donorAccountNumber' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('throws RefundNotFoundError for a nonexistent Refund, posting nothing', async () => {
    const { tx, rows } = makeTx({ refundRow: null });
    const prisma = makePrisma(tx, {});

    await expect(
      completeRefund(prisma as never, { refundId: 'missing', completedById: 'completer-1', ...validProof, ...validDestination }),
    ).rejects.toThrow(RefundNotFoundError);
    expect(rows).toHaveLength(0);
  });

  it('REGRESSION: a second concurrent completion loses the race and posts nothing', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx, rows } = makeTx({ refundRow });
    tx.refund.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma(tx, refundRow);

    await expect(
      completeRefund(prisma as never, { refundId: 'refund-1', completedById: 'completer-1', ...validProof, ...validDestination }),
    ).rejects.toThrow(InvalidRefundStatusError);
    expect(rows.filter((r) => r.transactionId === 'refund-completed-refund-1')).toHaveLength(0);
  });

  it('completes a Trip-linked refund the same way, taking no subject on the posted legs', async () => {
    const refundRow = baseApprovedRefundRow({ payment: makeTripPayment({ amount: 100_000, providerFee: 0 }) });
    const { tx, rows } = makeTx({ refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'COMPLETED' });

    await completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validDestination,
    });

    const posted = rows.filter((r) => r.transactionId === 'refund-completed-refund-1');
    expect(posted.every((r) => r.campaignId === null && r.volunteerTripId === null)).toBe(true);
  });

  it("refuses an Admin who is the Volunteer Trip's own Fundraiser, posting nothing", async () => {
    const refundRow = baseApprovedRefundRow({ payment: makeTripPayment() });
    const { tx, rows } = makeTx({ refundRow, tripFundraiserId: 'completer-1' });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validDestination,
    });

    await expect(attempt).rejects.toThrow(OwnSubjectConflictError);
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});
