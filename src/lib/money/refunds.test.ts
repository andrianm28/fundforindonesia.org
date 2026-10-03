import { describe, it, expect, vi } from 'vitest';
import { Kind } from '@/generated/prisma/client';
import {
  createRefund,
  approveRefund,
  completeRefund,
  DemoCampaignError,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundAfterCampaignTransferError,
  RefundExceedsRemainingError,
  RefundNotFoundError,
  RefundNotAllowedForKindError,
  RefundProofInvalidError,
  RefundDestinationInvalidError,
  RefundDestinationMismatchError,
  SelfApprovalError,
  InvalidRefundStatusError,
  RefundFreezeJournalMissingError,
  TwoPersonRuleError,
  OwnSubjectConflictError,
  rejectRefund,
  failRefund,
  RefundResolutionActorError,
  RefundReasonInvalidError,
} from './refunds';
import {
  paymentSettledLegs,
  escrowReleaseLegs,
  payoutInstructedLegs,
  refundRequestedLegs,
  refundApprovedLegs,
  platformFeePortionFor,
  providerFeePortionFor,
  InvalidLedgerLegError,
  type LedgerLeg,
  type LedgerSubject,
} from './ledger';
import { readRefundDonorAccountNumber, sealRefundDonorAccountNumber } from '@/lib/contact-fields';
import { ledgerGroupBy } from '../../../tests/support/ledger-group-by';

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

/** Ledger rows for the legs a builder in ./ledger produced, posted under one transactionId. */
const rowsOf = (legs: LedgerLeg[], transactionId: string): LedgerRow[] =>
  legs.map((l) => ({
    transactionId,
    direction: l.direction,
    amount: l.amount,
    account: l.account,
    campaignId: l.campaignId ?? null,
    volunteerTripId: l.volunteerTripId ?? null,
  }));

/**
 * The rows createRefund posts as a Refund's freeze, which approveRefund now reads
 * back (prd-compliance 51): the same legs, under the transactionId production
 * uses, so a fixture cannot hand approval a freeze production would never have
 * written.
 */
const freezeRows = (
  refundId: string,
  params: {
    amount: number;
    source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE';
    platformFeePortion?: number;
    providerFeePortion?: number;
    subject?: LedgerSubject;
  },
): LedgerRow[] =>
  rowsOf(
    refundRequestedLegs({
      subject: params.subject ?? { type: 'campaign', campaignId: 'campaign-1' },
      amount: params.amount,
      source: params.source,
      platformFeePortion: params.platformFeePortion ?? 0,
      providerFeePortion: params.providerFeePortion ?? 0,
    }),
    `refund-requested-${refundId}`,
  );

/**
 * `ledgerEntry.findMany` for the fakes below, answering the two shapes of
 * `transactionId` the money module asks with: one id, or `{ in: [...] }`.
 */
const entriesByTransactionId = (rows: LedgerRow[], where: { transactionId: string | { in: string[] } }) => {
  const ids = typeof where.transactionId === 'string' ? [where.transactionId] : where.transactionId.in;
  return rows.filter((r) => ids.includes(r.transactionId));
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
    priorRefunds?: Array<{ id: string; amount: number; status: string }>;
    refundRow?: Record<string, unknown> | null;
    /** The Campaign's Kind, which the per-Kind Refund rule reads. */
    kind?: Kind;
    /** APPROVED Campaign Transfers that left the Campaign (a transfer moved its balance away). */
    approvedTransfersOut?: number;
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
    async ({ where, data }: { where: { status: string | { in: string[] } }; data: Record<string, unknown> }) => {
      const allowed = typeof where.status === 'string' ? [where.status] : where.status.in;
      if (!state || !allowed.includes(state.status as string)) return { count: 0 };
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
        .map((r) => ({ id: r.id, amount: r.amount, status: r.status }));
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
      campaignTransfer: {
        count: vi.fn(async () => options.approvedTransfersOut ?? 0),
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
        findMany: vi.fn(async ({ where }: { where: { transactionId: string | { in: string[] } } }) =>
          entriesByTransactionId(rows, where),
        ),
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

/**
 * The Donor destination approveRefund now requires (Q7(c), ADR 0018
 * Amendment 2026-09-28): every approveRefund call in this file spreads
 * this in, unless a test is specifically exercising a missing or invalid
 * destination.
 */
const validDestination = {
  donorBankCode: 'BCA',
  donorAccountName: 'Budi Santoso',
  donorAccountNumber: '1234567890',
};

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

  it('refuses to freeze from CAMPAIGN_BALANCE when the balance cannot cover the net portion and a Campaign Transfer moved it away', async () => {
    const { tx, rows } = makeTx({
      payment: makePayment({ escrowReleasedAt: new Date('2026-01-01') }),
      ledgerRows: [{ transactionId: 'seed-funds', direction: 'CREDIT', amount: 10_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null }],
      approvedTransfersOut: 1,
    });

    await expect(
      createRefund(tx as never, {
        subject: { type: 'campaign', campaignId: 'campaign-1' },
        paymentId: 'payment-1',
        amount: 40_000,
        reason: 'x',
        requestedById: 'admin-1',
      }),
    ).rejects.toBeInstanceOf(RefundAfterCampaignTransferError);
    expect(rows.some((r) => r.transactionId === 'refund-requested-refund-1')).toBe(false);
  });

  it('still freezes an uncovered balance when no Campaign Transfer left the Campaign (a Payout drew it down: the platform covers the shortfall at approval)', async () => {
    const { tx, rows } = makeTx({
      payment: makePayment({ escrowReleasedAt: new Date('2026-01-01') }),
      ledgerRows: [{ transactionId: 'seed-funds', direction: 'CREDIT', amount: 10_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null }],
      approvedTransfersOut: 0,
    });

    await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'x',
      requestedById: 'admin-1',
    });

    expect(rows.some((r) => r.transactionId === 'refund-requested-refund-1')).toBe(true);
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
    // The prior Refund carries the freeze createRefund would have posted for it
    // (prd-compliance 53: the next Refund's fee share is read off it).
    const { tx, refundCreate } = makeTx({
      payment: makePayment({ amount: 100_000 }),
      priorRefunds: [{ id: 'refund-prior', amount: 40_000, status: 'REQUESTED' }],
      ledgerRows: freezeRows('refund-prior', { amount: 40_000, source: 'ESCROW_HOLD', providerFeePortion: 2_000 }),
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
      priorRefunds: [{ id: 'refund-prior', amount: 90_000, status: 'REJECTED' }],
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
      ...freezeRows('refund-1', { amount: 100_000, source: 'ESCROW_HOLD' }),
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 0 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED', approvedById: 'admin-1' });

    const result = await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

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
      ...freezeRows('refund-1', { amount: 100_000, source: 'ESCROW_HOLD' }),
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 0 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow, lifecycleStatus: 'SUSPENDED' });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED', approvedById: 'admin-1' });

    const result = await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

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
    // NET credited) and the freeze (95_000, this refund's own net share) net
    // the pool to exactly 0. Approval must NOT re-split or re-post the fee:
    // it only closes FROZEN_BALANCE and credits the donor the full Gross.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 95_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      ...freezeRows('refund-1', { amount: 100_000, source: 'ESCROW_HOLD', providerFeePortion: 5_000 }),
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 5_000 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

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
    // settle-1 (92_500) and the freeze (92_500) net the pool to exactly 0.
    // Approval must not re-split or re-post either fee.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 92_500, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      ...freezeRows('refund-1', { amount: 100_000, source: 'ESCROW_HOLD', platformFeePortion: 2_500, providerFeePortion: 5_000 }),
    ];
    const refundRow = baseRefundRow({
      amount: 100_000,
      payment: makePayment({ amount: 100_000, providerFee: 5_000, platformFee: 2_500 }),
    });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

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
    // credits the real NET (96_667), the freeze debits this refund's own
    // 48_333 net share -- pool stays healthy (48_334), so approval posts
    // only the simple 2-leg settlement.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 96_667, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      ...freezeRows('refund-1', { amount: 50_000, source: 'ESCROW_HOLD', providerFeePortion: 1_667 }),
    ];
    const refundRow = baseRefundRow({ amount: 50_000, payment: makePayment({ amount: 100_000, providerFee: 3_333 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

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
    // = -85_000. netPortion = 100_000 - 0 - 5_000 = 95_000 (the
    // providerFeePortion is the REFUND_COST leg the freeze posted).
    // shortfall = min(max(0, 85_000), 95_000) =
    // 85_000 -- genuine insolvency, not a fee artifact (the fee was already
    // handled at freeze time, so it plays no part in this shortfall at all).
    // FROZEN_BALANCE debits the full 100_000 (closing it out). REFUND_COST =
    // 85_000. The matching CREDIT CAMPAIGN_BALANCE 85_000 brings the
    // campaign's own balance from -85_000 back to exactly 0 -- the platform
    // absorbing the shortfall, not the fee (already absorbed at freeze).
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 95_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'payout-1', direction: 'DEBIT', amount: 85_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      ...freezeRows('refund-1', { amount: 100_000, source: 'CAMPAIGN_BALANCE', providerFeePortion: 5_000 }),
    ];
    const refundRow = baseRefundRow({
      amount: 100_000,
      payment: makePayment({ amount: 100_000, providerFee: 5_000, escrowReleasedAt: new Date('2026-01-01') }),
    });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ amount: 100_000 });
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 85_000 });
    expect(posted.find((r) => r.account === 'REFUND_CLEARING')).toMatchObject({ amount: 100_000 });
    expect(posted.find((r) => r.account === 'CAMPAIGN_BALANCE' && r.direction === 'CREDIT')).toMatchObject({ amount: 85_000 });
  });

  it('settles a Trip-linked refund debiting FROZEN_BALANCE with volunteerTripId, never touching a Campaign row', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
      ...freezeRows('refund-1', { amount: 100_000, source: 'ESCROW_HOLD', subject: { type: 'trip', tripId: 'trip-1' } }),
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makeTripPayment({ amount: 100_000, providerFee: 0 }) });
    const { tx, rows, queryRawCalls } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.some((r) => r.campaignId)).toBe(false);
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ volunteerTripId: 'trip-1' });
    expect(queryRawCalls.some((q) => q.includes('VolunteerTrip'))).toBe(true);
    expect(queryRawCalls.some((q) => q.includes('"Campaign"'))).toBe(false);
  });

  it('refuses self-approval, posting no ledger entries', async () => {
    const { tx, rows } = makeTx({ refundRow: baseRefundRow({ requestedById: 'same-person' }) });
    const prisma = makePrisma(tx, baseRefundRow());

    await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'same-person', ...validDestination })).rejects.toThrow(SelfApprovalError);
    expect(rows).toHaveLength(0);
  });

  it('refuses an Admin who is the Campaign\'s own Fundraiser, leaving the Refund REQUESTED and posting nothing', async () => {
    const refundRow = baseRefundRow({ payment: makePayment() });
    const { tx, rows } = makeTx({ refundRow, campaignCreatorId: 'admin-1' });
    const prisma = makePrisma(tx, refundRow);

    const attempt = approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

    await expect(attempt).rejects.toThrow(OwnSubjectConflictError);
    await expect(attempt).rejects.toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT', message: expect.stringContaining('harus dilakukan Admin lain') });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('refuses an Admin who is the Volunteer Trip\'s own Fundraiser, leaving the Refund REQUESTED and posting nothing', async () => {
    const refundRow = baseRefundRow({ payment: makeTripPayment() });
    const { tx, rows } = makeTx({ refundRow, tripFundraiserId: 'admin-1' });
    const prisma = makePrisma(tx, refundRow);

    const attempt = approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

    await expect(attempt).rejects.toThrow(OwnSubjectConflictError);
    await expect(attempt).rejects.toMatchObject({ code: 'OWN_TRIP_CONFLICT', message: expect.stringContaining('harus dilakukan Admin lain') });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('throws RefundNotFoundError for a nonexistent Refund, posting no ledger entries', async () => {
    const { tx, rows } = makeTx({ refundRow: null });
    const prisma = makePrisma(tx, {});

    await expect(approveRefund(prisma as never, { refundId: 'missing', approvedById: 'admin-1', ...validDestination })).rejects.toThrow(RefundNotFoundError);
    expect(rows).toHaveLength(0);
  });

  it('throws InvalidRefundStatusError when the Refund is already APPROVED, REJECTED, or FAILED, posting no ledger entries', async () => {
    for (const status of ['APPROVED', 'REJECTED', 'FAILED']) {
      const { tx, rows } = makeTx({ refundRow: baseRefundRow({ status }) });
      const prisma = makePrisma(tx, baseRefundRow({ status }));

      await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination })).rejects.toThrow(InvalidRefundStatusError);
      expect(rows).toHaveLength(0);
    }
  });

  it('REGRESSION: a second concurrent approval loses the race and posts nothing', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      // The Refund's own freeze, so what refuses the approval below is the lost
      // race and not a missing journal.
      ...freezeRows('refund-1', { amount: 40_000, source: 'ESCROW_HOLD', providerFeePortion: 2_000 }),
    ];
    const { tx, rows } = makeTx({ ledgerRows, refundRow: baseRefundRow() });
    // Simulates another approval having already flipped this Refund's status
    // out of REQUESTED between this call's read and its write -- exactly
    // what a real database's WHERE-matched updateMany returns for the loser.
    tx.refund.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma(tx, baseRefundRow());

    const attempt = approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

    await expect(attempt).rejects.toThrow(InvalidRefundStatusError);
    await expect(attempt).rejects.toMatchObject({ detail: 'lost the approval race' });
    expect(rows.filter((r) => r.transactionId === 'refund-approved-refund-1')).toHaveLength(0);
  });

  // Q7(c), ADR 0018 Amendment 2026-09-28: the destination moved here from
  // completion -- an approval with no destination is refused, and the
  // number is sealed, never written or returned plain.
  it('refuses an approval with a blank donor bank code, naming the field, posting nothing', async () => {
    const { tx, rows } = makeTx({ refundRow: baseRefundRow() });
    const prisma = makePrisma(tx, baseRefundRow());

    const attempt = approveRefund(prisma as never, {
      refundId: 'refund-1',
      approvedById: 'admin-1',
      ...validDestination,
      donorBankCode: '   ',
    });

    await expect(attempt).rejects.toThrow(RefundDestinationInvalidError);
    await expect(attempt).rejects.toMatchObject({ field: 'donorBankCode' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('refuses an approval with a blank donor account name, naming the field, posting nothing', async () => {
    const { tx, rows } = makeTx({ refundRow: baseRefundRow() });
    const prisma = makePrisma(tx, baseRefundRow());

    const attempt = approveRefund(prisma as never, {
      refundId: 'refund-1',
      approvedById: 'admin-1',
      ...validDestination,
      donorAccountName: '',
    });

    await expect(attempt).rejects.toThrow(RefundDestinationInvalidError);
    await expect(attempt).rejects.toMatchObject({ field: 'donorAccountName' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('refuses an approval with a blank donor account number, naming the field, posting nothing (approval without a destination is refused)', async () => {
    const { tx, rows } = makeTx({ refundRow: baseRefundRow() });
    const prisma = makePrisma(tx, baseRefundRow());

    const attempt = approveRefund(prisma as never, {
      refundId: 'refund-1',
      approvedById: 'admin-1',
      ...validDestination,
      donorAccountNumber: '',
    });

    await expect(attempt).rejects.toThrow(RefundDestinationInvalidError);
    await expect(attempt).rejects.toMatchObject({ field: 'donorAccountNumber' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('checks the destination before opening any transaction: a blank field never reaches the database read', async () => {
    const { tx } = makeTx({ refundRow: baseRefundRow() });
    const prisma = makePrisma(tx, baseRefundRow());

    await expect(
      approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination, donorAccountNumber: '' }),
    ).rejects.toThrow(RefundDestinationInvalidError);
    expect(tx.refund.findUnique).not.toHaveBeenCalled();
  });

  it('records the sealed donor account number on approval, never the plaintext, decrypting back to what was typed', async () => {
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 0 }) });
    const { tx } = makeTx({ refundRow, ledgerRows: freezeRows('refund-1', { amount: 100_000, source: 'ESCROW_HOLD' }) });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

    const call = (tx.refund.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const written = call.data as Record<string, unknown>;
    expect(written.donorBankCode).toBe('BCA');
    expect(written.donorAccountName).toBe('Budi Santoso');
    expect(written.donorAccountNumberCiphertext).toEqual(expect.any(String));
    expect(written.donorAccountNumberCiphertext).not.toBe('1234567890');
    expect(
      readRefundDonorAccountNumber({
        donorAccountNumberCiphertext: written.donorAccountNumberCiphertext as string,
        donorAccountNumberKeyId: written.donorAccountNumberKeyId as string,
      }),
    ).toBe('1234567890');
  });

  it(
    "covers the net share the Refund's own freeze took, not the one worked out again from the Refunds that stand now " +
      '(prd-compliance 51)',
    async () => {
      // Gross 100_000, Provider Fee 3_333, Platform Fee 1_667: Net 95_000, released
      // to CAMPAIGN_BALANCE and then taken out in full by a Payout. Two 50_000
      // Refunds were open at once.
      //
      // refund-1 was frozen against no earlier Refund, so its shares rounded up
      // whole, 834 (Platform Fee) and 1_667 (Provider Fee), and it debited
      // CAMPAIGN_BALANCE 50_000 - 834 - 1_667 = 47_499. refund-2 was frozen with
      // refund-1 still counted, so the cumulative cap cut its shares to what the
      // Payment had left, 833 and 1_666, and it debited 50_000 - 833 - 1_666 =
      // 47_501. refund-1 is then REJECTED and its freeze mirrored back, which
      // leaves the pool at exactly what refund-2's freeze took: -47_501.
      //
      // Worked out again from the Refunds that stand now, refund-2 has no earlier
      // Refund: shares of 834 and 1_667, a net of 47_499. Covering that leaves the
      // pool at -2 and REFUND_COST two rupiah short.
      const payment = makePayment({
        amount: 100_000,
        providerFee: 3_333,
        platformFee: 1_667,
        escrowReleasedAt: new Date('2026-01-01'),
      });
      const ledgerRows: LedgerRow[] = [
        { transactionId: 'settle-1', direction: 'CREDIT', amount: 95_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
        { transactionId: 'payout-1', direction: 'DEBIT', amount: 95_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
        { transactionId: 'refund-requested-refund-1', direction: 'DEBIT', amount: 47_499, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
        { transactionId: 'refund-rejected-refund-1', direction: 'CREDIT', amount: 47_499, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
        ...freezeRows('refund-2', { amount: 50_000, source: 'CAMPAIGN_BALANCE', platformFeePortion: 833, providerFeePortion: 1_666 }),
      ];
      // refund-1 is REJECTED, so no Refund stands ahead of refund-2 any more.
      const refundRow = baseRefundRow({ id: 'refund-2', amount: 50_000, payment });
      const { tx, rows } = makeTx({ ledgerRows, refundRow });
      const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

      await approveRefund(prisma as never, { refundId: 'refund-2', approvedById: 'admin-1', ...validDestination });

      const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-2');
      expect(posted).toContainEqual(expect.objectContaining({ account: 'REFUND_COST', direction: 'DEBIT', amount: 47_501 }));
      expect(posted).toContainEqual(
        expect.objectContaining({ account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 47_501, campaignId: 'campaign-1' }),
      );
      const poolNet = rows
        .filter((r) => r.account === 'CAMPAIGN_BALANCE' && r.campaignId === 'campaign-1')
        .reduce((sum, r) => sum + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);
      expect(poolNet).toBe(0);
    },
  );

  it('refuses to approve a Refund whose freeze journal is missing: it stays REQUESTED and nothing is posted', async () => {
    // createRefund posts the freeze in the same transaction as the Refund, so this
    // should not happen. If it does, approving from a guess at its fee shares
    // would cover the wrong shortfall, so the approval is refused, ahead of the
    // claim on the row.
    const refundRow = baseRefundRow();
    const { tx, rows } = makeTx({ ledgerRows: [], refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1', ...validDestination });

    await expect(attempt).rejects.toThrow(RefundFreezeJournalMissingError);
    await expect(attempt).rejects.toMatchObject({ code: 'REFUND_FREEZE_JOURNAL_MISSING', refundIds: ['refund-1'] });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
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
    // Asked when a Refund frozen from CAMPAIGN_BALANCE finds the balance short:
    // none of these scenarios moved a balance to another Campaign.
    campaignTransfer: { count: vi.fn(async () => 0) },
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
            .map((r) => ({ id: r.id, amount: r.amount, status: r.status })),
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; status: string | { in: string[] } }; data: Record<string, unknown> }) => {
          const row = refunds.get(where.id);
          const allowed = typeof where.status === 'string' ? [where.status] : where.status.in;
          if (!row || !allowed.includes(row.status as string)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    ledgerEntry: {
      count: vi.fn(async () => 0),
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        rows.push(...data);
        return { count: data.length };
      }),
      groupBy: vi.fn(ledgerGroupBy(rows)),
      // The freeze journal approveRefund reads back (prd-compliance 51).
      findMany: vi.fn(async ({ where }: { where: { transactionId: string | { in: string[] } } }) =>
        entriesByTransactionId(rows, where),
      ),
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

    await approveRefund(prisma as never, { refundId: refundA.id, approvedById: 'admin-2', ...validDestination });
    await approveRefund(prisma as never, { refundId: refundB.id, approvedById: 'admin-2', ...validDestination });

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

describe('createRefund after an earlier Refund was rejected or failed (prd-compliance 53)', () => {
  // Gross 100_000, Provider Fee 3_333 and Platform Fee 1_667: neither fee splits
  // evenly across two 50_000 Refunds (1_666.5 and 833.5), so one of the two takes
  // the rounded-up half and the other the rupiah the cumulative cap leaves it.
  // The pool the Payment settled into held 95_000.
  const subject = { type: 'campaign' as const, campaignId: 'campaign-1' };

  function setup() {
    const harness = makeMultiPaymentTx([
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 95_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ]);
    harness.payments.set('payment-1', makePayment({ amount: 100_000, providerFee: 3_333, platformFee: 1_667 }));
    return harness;
  }

  const request = (tx: ReturnType<typeof makeMultiPaymentTx>['tx'], amount: number) =>
    createRefund(tx as never, { subject, paymentId: 'payment-1', amount, reason: 'x', requestedById: 'admin-1' });

  /** The debit legs a Refund's freeze posted, as account -> amount. */
  const frozenBy = (rows: LedgerRow[], refundId: string): Record<string, number> =>
    Object.fromEntries(
      rows
        .filter((r) => r.transactionId === `refund-requested-${refundId}` && r.direction === 'DEBIT')
        .map((r) => [r.account, r.amount]),
    );

  it('gives the Refund that follows a rejection the share the rejected one held, so the standing Refunds carry the whole fee', async () => {
    const { tx, prisma, rows } = setup();

    // Both open at once: the second is frozen with the first still counted, so it
    // carries the cut shares (833 and 1_666), the first the rounded-up ones (834
    // and 1_667).
    const first = await request(tx, 50_000);
    const second = await request(tx, 50_000);
    expect(frozenBy(rows, first.id)).toEqual({ ESCROW_HOLD: 47_499, PLATFORM_FEE: 834, REFUND_COST: 1_667 });
    expect(frozenBy(rows, second.id)).toEqual({ ESCROW_HOLD: 47_501, PLATFORM_FEE: 833, REFUND_COST: 1_666 });

    // The first is rejected, so only the second stands and the rest of the Payment
    // is open again. The third, for that rest, has to take the rupiah the second
    // was cut by: 834 and 1_667, not the 833 and 1_666 a recomputation against the
    // second's amount alone gives.
    await rejectRefund(prisma as never, { refundId: first.id, rejectedById: 'admin-2', reason: 'Salah Payment' });
    const third = await request(tx, 50_000);

    expect(frozenBy(rows, third.id)).toEqual({ ESCROW_HOLD: 47_499, PLATFORM_FEE: 834, REFUND_COST: 1_667 });
    const standing = [frozenBy(rows, second.id), frozenBy(rows, third.id)];
    expect(standing[0].PLATFORM_FEE + standing[1].PLATFORM_FEE).toBe(1_667);
    expect(standing[0].REFUND_COST + standing[1].REFUND_COST).toBe(3_333);
    // 95_000 settled, less the two standing Refunds' nets (47_501 and 47_499).
    expect(escrowNetOf(rows, 'campaign-1')).toBe(0);
  });

  it('gives a Refund created after one that failed after approval the same shares as after a rejection', async () => {
    const { tx, prisma, rows } = setup();
    const first = await request(tx, 50_000);
    const second = await request(tx, 50_000);
    await approveRefund(prisma as never, { refundId: first.id, approvedById: 'admin-3', ...validDestination });
    await approveRefund(prisma as never, { refundId: second.id, approvedById: 'admin-3', ...validDestination });
    await failRefund(prisma as never, { refundId: first.id, failedById: 'admin-4', reason: 'Rekening Donor ditutup' });

    const third = await request(tx, 50_000);

    expect(frozenBy(rows, third.id)).toEqual({ ESCROW_HOLD: 47_499, PLATFORM_FEE: 834, REFUND_COST: 1_667 });
    expect(escrowNetOf(rows, 'campaign-1')).toBe(0);
  });

  it('takes up a share the cap once cut from a Refund that still stands, once the Refunds that cut it are rejected', async () => {
    const { tx, prisma, rows } = setup();

    // Three open at once. The third is cut twice over, by the first and by the
    // second: 416 of the Platform Fee where its own share is 417, and 832 of the
    // Provider Fee where its own is 834.
    const first = await request(tx, 50_000);
    const second = await request(tx, 25_000);
    const third = await request(tx, 25_000);
    expect(frozenBy(rows, third.id)).toEqual({ ESCROW_HOLD: 23_752, PLATFORM_FEE: 416, REFUND_COST: 832 });

    // Only the third stands once the other two are rejected. The fourth, for the
    // 75_000 that is left, has to take up what the third was cut by on top of its
    // own share of 1_251 and 2_500: 1_251 and 2_501. Capped only by the fee that
    // is not yet posted, without taking up the cut, it stops a rupiah short on the
    // Provider Fee (2_500), and the Payment ends with 3_332 of its 3_333 taken and
    // ESCROW_HOLD at -1.
    await rejectRefund(prisma as never, { refundId: first.id, rejectedById: 'admin-2', reason: 'Salah Payment' });
    await rejectRefund(prisma as never, { refundId: second.id, rejectedById: 'admin-2', reason: 'Salah Payment' });
    const fourth = await request(tx, 75_000);

    expect(frozenBy(rows, fourth.id)).toEqual({ ESCROW_HOLD: 71_248, PLATFORM_FEE: 1_251, REFUND_COST: 2_501 });
    const standing = [frozenBy(rows, third.id), frozenBy(rows, fourth.id)];
    expect(standing[0].PLATFORM_FEE + standing[1].PLATFORM_FEE).toBe(1_667);
    expect(standing[0].REFUND_COST + standing[1].REFUND_COST).toBe(3_333);
    expect(escrowNetOf(rows, 'campaign-1')).toBe(0);
  });

  it('leaves a series of partial Refunds with no rejection on the shares it always had: each rounded up, the cap cutting only the last', async () => {
    const { tx, rows } = setup();

    const first = await request(tx, 50_000);
    const second = await request(tx, 40_000);
    const third = await request(tx, 10_000);

    // Each Refund carries the rounded-up share of its own amount: for the 40_000,
    // 1_334 of the Provider Fee (3_333 over it is 1_333.2) and 667 of the Platform
    // Fee (666.8). Two Refunds in, that is 3_001 of the Provider Fee, where one
    // rounded-up share of their 90_000 together would be 3_000: the shares are
    // added up one Refund at a time, and this series must not move to the other
    // rule. The cap takes the last Refund down to what is left, 332 and 166
    // (its own shares would be 334 and 167).
    expect(frozenBy(rows, first.id)).toEqual({ ESCROW_HOLD: 47_499, PLATFORM_FEE: 834, REFUND_COST: 1_667 });
    expect(frozenBy(rows, second.id)).toEqual({ ESCROW_HOLD: 37_999, PLATFORM_FEE: 667, REFUND_COST: 1_334 });
    expect(frozenBy(rows, third.id)).toEqual({ ESCROW_HOLD: 9_502, PLATFORM_FEE: 166, REFUND_COST: 332 });
    expect(escrowNetOf(rows, 'campaign-1')).toBe(0);
  });

  it('covers exactly the net share a Refund froze when the pool was drained by a Payout and it is approved while another is still open', async () => {
    // Settled, released to the Campaign's withdrawable balance, and paid out in
    // full: the empty pool a later Refund finds, with the Payment's escrow matured.
    const { tx, prisma, rows, payments } = makeMultiPaymentTx([
      ...rowsOf(paymentSettledLegs({ subject, grossAmount: 100_000, providerFee: 3_333, platformFee: 1_667 }), 'settle-1'),
      ...rowsOf(escrowReleaseLegs({ subject, amount: 95_000 }), 'escrow-release-1'),
      ...rowsOf(payoutInstructedLegs({ subject, amount: 95_000 }), 'payout-1'),
    ]);
    payments.set('payment-1', makePayment({ amount: 100_000, providerFee: 3_333, platformFee: 1_667, escrowReleasedAt: new Date(2026, 0, 1) }));
    const withdrawable = () =>
      rows
        .filter((r) => r.account === 'CAMPAIGN_BALANCE' && r.campaignId === 'campaign-1')
        .reduce((sum, r) => sum + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);
    const approvedBy = (refundId: string) =>
      Object.fromEntries(
        rows
          .filter((r) => r.transactionId === `refund-approved-${refundId}` && r.direction === 'DEBIT')
          .map((r) => [r.account, r.amount]),
      );

    // Two Refunds open on the empty pool: each freeze takes the balance further
    // below zero, by 47_499 and by 47_501.
    const first = await request(tx, 50_000);
    const second = await request(tx, 50_000);
    expect(withdrawable()).toBe(-95_000);

    // The first is approved before the second, so the pool is still 95_000 below
    // zero, more than the first's whole net share, which the platform covers
    // exactly: 50_000 less the 834 and 1_667 its freeze took as fees. An approval
    // that left out the Platform Fee share would cover 48_333, one that left out
    // the Provider Fee share (REFUND_COST) 49_166, one that left out both 50_000.
    // Approving the second AFTER the first is rejected cannot tell them apart:
    // the pool is then no deeper than that Refund's own freeze, so the shortfall
    // is capped at it whatever the shares were.
    await approveRefund(prisma as never, { refundId: first.id, approvedById: 'admin-3', ...validDestination });

    expect(approvedBy(first.id)).toEqual({ FROZEN_BALANCE: 50_000, REFUND_COST: 47_499 });
    expect(withdrawable()).toBe(-47_501);

    await approveRefund(prisma as never, { refundId: second.id, approvedById: 'admin-3', ...validDestination });

    expect(approvedBy(second.id)).toEqual({ FROZEN_BALANCE: 50_000, REFUND_COST: 47_501 });
    expect(withdrawable()).toBe(0);
  });

  it('gives a Refund nothing, never a negative share, once the standing Refunds carry more than the cumulative portion', async () => {
    // A Payment of 10_000 with a Provider Fee of 10, settled into a pool of 9_990:
    // a Refund of 1_000 carries 1, rounded up.
    const { tx, prisma, rows, payments } = makeMultiPaymentTx([
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 9_990, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ]);
    payments.set('payment-1', makePayment({ amount: 10_000, providerFee: 10, platformFee: 0 }));
    const reject = (refundId: string) =>
      rejectRefund(prisma as never, { refundId, rejectedById: 'admin-2', reason: 'Salah Payment' });

    // Three open one after the other: 2, then 1, then 7 (its own 9, less the 2
    // the first two took).
    const first = await request(tx, 1_010);
    const second = await request(tx, 100);
    const third = await request(tx, 8_001);
    expect(frozenBy(rows, first.id)).toEqual({ ESCROW_HOLD: 1_008, REFUND_COST: 2 });
    expect(frozenBy(rows, second.id)).toEqual({ ESCROW_HOLD: 99, REFUND_COST: 1 });
    expect(frozenBy(rows, third.id)).toEqual({ ESCROW_HOLD: 7_994, REFUND_COST: 7 });

    // The first two are rejected. A Refund of 100 takes up the 2 the third was cut
    // by, on top of its own 1.
    await reject(first.id);
    await reject(second.id);
    const fourth = await request(tx, 100);
    expect(frozenBy(rows, fourth.id)).toEqual({ ESCROW_HOLD: 97, REFUND_COST: 3 });

    // Then the third is rejected too, and the fourth keeps the 3 it posted, where
    // the cumulative portion of it and the next 100 is 2. The next Refund of 100
    // carries no fee at all: a share of -1 would debit the pool 101 against a
    // freeze of 100, and the freeze would not balance.
    await reject(third.id);
    const fifth = await request(tx, 100);
    expect(frozenBy(rows, fifth.id)).toEqual({ ESCROW_HOLD: 100 });
    // The pool held 9_990 and the two Refunds that stand took 97 and 100 of it.
    expect(escrowNetOf(rows, 'campaign-1')).toBe(9_793);
  });

  it('refuses a Refund too small to carry its own two fee shares, posting nothing', async () => {
    // One rupiah of a Payment with both fees: each share rounds up to 1, so the two
    // come to 2 against an amount of 1. The freeze is refused as it is built; left
    // to the ledger's own balance check it would fail as an unbalanced posting
    // instead, with the same nothing posted but a worse message.
    const { tx, rows } = setup();

    await expect(request(tx, 1)).rejects.toThrow(InvalidLedgerLegError);
    expect(rows.filter((r) => r.transactionId.startsWith('refund-requested-'))).toEqual([]);
  });

  it('refuses a Payment whose standing Refund has no freeze journal, writing nothing, rather than guess what that Refund took', async () => {
    // createRefund posts the journal in the transaction that creates the Refund,
    // so this should not happen. If it does, the next Refund's share measured
    // against "took nothing" would be the whole of the fee again.
    const { tx, refundCreate, rows } = makeTx({
      payment: makePayment({ amount: 100_000, providerFee: 3_333, platformFee: 1_667 }),
      priorRefunds: [{ id: 'refund-orphan', amount: 40_000, status: 'REQUESTED' }],
    });

    await expect(
      createRefund(tx as never, { subject, paymentId: 'payment-1', amount: 60_000, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toMatchObject({ code: 'REFUND_FREEZE_JOURNAL_MISSING', refundIds: ['refund-orphan'] });
    expect(refundCreate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});

describe('completeRefund', () => {
  /**
   * donorAccountNumberCiphertext/KeyId are populated as though approveRefund
   * already recorded them (Q7(c), ADR 0018 Amendment 2026-09-28): this
   * describe block never calls approveRefund itself, so the sealed number
   * has to be seeded onto the row directly, the same way a real APPROVED
   * Refund would already carry it by the time completeRefund reads it.
   */
  const baseApprovedRefundRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'refund-1',
    paymentId: 'payment-1',
    amount: 100_000,
    reason: 'x',
    status: 'APPROVED',
    requestedById: 'requester-1',
    approvedById: 'approver-1',
    donorBankCode: 'BCA',
    donorAccountName: 'Budi Santoso',
    ...sealRefundDonorAccountNumber('1234567890'),
    payment: makePayment({ amount: 100_000, providerFee: 0 }),
    ...overrides,
  });

  const validProof = {
    proofReference: 'TRX-refund-1',
    proofNote: 'Ditransfer via mobile banking BCA, dicocokkan dengan nama dan rekening Donor.',
  };
  // The completing Admin's RE-TYPED number (Q7(c)): completeRefund no
  // longer accepts a bank code or account name of its own -- those were
  // moved to approveRefund -- so this is the only destination input left.
  const validRetype = {
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
      ...validRetype,
    });

    expect(result.status).toBe('COMPLETED');
    const posted = rows.filter((r) => r.transactionId === 'refund-completed-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'REFUND_CLEARING', direction: 'DEBIT', amount: 100_000, campaignId: null, volunteerTripId: null }),
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 100_000, campaignId: null, volunteerTripId: null }),
    ]);
  });

  it('records completedById, completedAt and the joined proof, writing no destination fields of its own (Q7(c))', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'COMPLETED' });

    await completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validRetype,
    });

    expect(tx.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'refund-1', status: 'APPROVED' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          completedById: 'completer-1',
          completedAt: expect.any(Date),
          proofImage: 'TRX-refund-1 — Ditransfer via mobile banking BCA, dicocokkan dengan nama dan rekening Donor.',
        }),
      }),
    );
    const call = (tx.refund.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const written = call.data as Record<string, unknown>;
    // No destination of its own any more: completion neither writes nor
    // re-seals a bank code, account name, or account number -- the sealed
    // number recorded at approval is left exactly as it was.
    expect(written).not.toHaveProperty('donorBankCode');
    expect(written).not.toHaveProperty('donorAccountName');
    expect(written).not.toHaveProperty('donorAccountNumberCiphertext');
    expect(written).not.toHaveProperty('donorAccountNumberKeyId');
  });

  it('accepts a re-typed number with different punctuation around the same digits (normalised, constant-time comparison)', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'COMPLETED' });

    const result = await completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      donorAccountNumber: '1234-5678-90',
    });

    expect(result.status).toBe('COMPLETED');
  });

  it('refuses a re-typed number that does not match what was recorded at approval, posting nothing (REFUND_DESTINATION_MISMATCH)', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx, rows } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      donorAccountNumber: '9999999999',
    });

    await expect(attempt).rejects.toThrow(RefundDestinationMismatchError);
    await expect(attempt).rejects.toMatchObject({ code: 'REFUND_DESTINATION_MISMATCH' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('refuses completion when the Refund never got a sealed number recorded at all, posting nothing', async () => {
    const refundRow = baseApprovedRefundRow({
      donorAccountNumberCiphertext: null,
      donorAccountNumberKeyId: null,
    });
    const { tx, rows } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validRetype,
    });

    await expect(attempt).rejects.toThrow(RefundDestinationMismatchError);
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('never puts the plaintext account number, typed or recorded, anywhere in what it returns', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'COMPLETED' });

    const result = await completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      ...validRetype,
    });

    expect(JSON.stringify(result)).not.toContain('1234567890');
  });

  it('refuses the Admin who REQUESTED this Refund, posting nothing', async () => {
    const refundRow = baseApprovedRefundRow({ requestedById: 'same-person' });
    const { tx, rows } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'same-person',
      ...validProof,
      ...validRetype,
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
      ...validRetype,
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
      completeRefund(prisma as never, { refundId: 'refund-1', completedById: 'completer-1', ...validProof, ...validRetype }),
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
      ...validRetype,
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
        ...validRetype,
      }),
    ).rejects.toThrow(RefundProofInvalidError);
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(tx.refund.findUnique).not.toHaveBeenCalled();
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
        ...validRetype,
      }),
    ).rejects.toThrow(RefundProofInvalidError);
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a blank re-typed donor account number, naming the field, before opening any transaction', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx } = makeTx({ refundRow });
    const prisma = makePrisma(tx, refundRow);

    const attempt = completeRefund(prisma as never, {
      refundId: 'refund-1',
      completedById: 'completer-1',
      ...validProof,
      donorAccountNumber: '',
    });

    await expect(attempt).rejects.toThrow(RefundDestinationInvalidError);
    await expect(attempt).rejects.toMatchObject({ field: 'donorAccountNumber' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(tx.refund.findUnique).not.toHaveBeenCalled();
  });

  it('throws RefundNotFoundError for a nonexistent Refund, posting nothing', async () => {
    const { tx, rows } = makeTx({ refundRow: null });
    const prisma = makePrisma(tx, {});

    await expect(
      completeRefund(prisma as never, { refundId: 'missing', completedById: 'completer-1', ...validProof, ...validRetype }),
    ).rejects.toThrow(RefundNotFoundError);
    expect(rows).toHaveLength(0);
  });

  it('REGRESSION: a second concurrent completion loses the race and posts nothing', async () => {
    const refundRow = baseApprovedRefundRow();
    const { tx, rows } = makeTx({ refundRow });
    tx.refund.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma(tx, refundRow);

    await expect(
      completeRefund(prisma as never, { refundId: 'refund-1', completedById: 'completer-1', ...validProof, ...validRetype }),
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
      ...validRetype,
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
      ...validRetype,
    });

    await expect(attempt).rejects.toThrow(OwnSubjectConflictError);
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});

describe('rejectRefund and failRefund (ticket 49)', () => {
  const AMOUNT = 100_000;
  const paymentFor = (overrides: Record<string, unknown> = {}) =>
    makePayment({ amount: AMOUNT, providerFee: 5_000, platformFee: 2_500, ...overrides });

  /** Rows as createRefund (and, when approved, approveRefund) would have posted them. */
  function journal(opts: { source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE'; approved?: boolean; shortfall?: number }): LedgerRow[] {
    const subject = { type: 'campaign' as const, campaignId: 'campaign-1' };
    const payment = paymentFor();
    const platformFeePortion = platformFeePortionFor(payment, AMOUNT, []);
    const providerFeePortion = providerFeePortionFor(payment, AMOUNT, []);
    const out = rowsOf(
      refundRequestedLegs({ subject, amount: AMOUNT, source: opts.source, platformFeePortion, providerFeePortion }),
      'refund-requested-refund-1',
    );
    if (opts.approved) {
      out.push(
        ...rowsOf(
          refundApprovedLegs({ subject, amount: AMOUNT, source: opts.source, shortfall: opts.shortfall ?? 0 }),
          'refund-approved-refund-1',
        ),
      );
    }
    return out;
  }

  const refundRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'refund-1',
    paymentId: 'payment-1',
    amount: AMOUNT,
    status: 'REQUESTED',
    requestedById: 'requester-1',
    approvedById: null,
    payment: paymentFor(),
    ...overrides,
  });

  /** Signed (credit +, debit -) net per account/subject over every row. */
  function netByAccount(rows: LedgerRow[]): Record<string, number> {
    const net: Record<string, number> = {};
    for (const r of rows) {
      const key = `${r.account}:${r.campaignId ?? ''}`;
      net[key] = (net[key] ?? 0) + (r.direction === 'CREDIT' ? r.amount : -r.amount);
    }
    return net;
  }

  const allZero = (net: Record<string, number>) => Object.values(net).every((v) => v === 0);

  function setup(opts: {
    status: string;
    source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE';
    approved?: boolean;
    shortfall?: number;
    row?: Record<string, unknown>;
  }) {
    const payment = paymentFor({ escrowReleasedAt: opts.source === 'CAMPAIGN_BALANCE' ? new Date(2026, 0, 1) : null });
    const row = refundRow({ status: opts.status, payment, ...opts.row });
    const ledgerRows = journal({ source: opts.source, approved: opts.approved, shortfall: opts.shortfall });
    const { tx, rows } = makeTx({ ledgerRows, refundRow: row, payment });
    const prisma = makePrisma(tx, row);
    return { prisma, rows, tx, row, before: ledgerRows.length };
  }

  it('reject mirrors the freeze exactly: every account that was debited or credited returns to zero', async () => {
    const { prisma, rows, before } = setup({ status: 'REQUESTED', source: 'CAMPAIGN_BALANCE' });
    expect(allZero(netByAccount(rows))).toBe(false);

    await rejectRefund(prisma as never, { refundId: 'refund-1', rejectedById: 'admin-2', reason: ' salah input ' });

    const posted = rows.slice(before);
    expect(posted.every((r) => r.transactionId === 'refund-rejected-refund-1')).toBe(true);
    expect(posted).toContainEqual(expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'DEBIT', amount: AMOUNT, campaignId: 'campaign-1' }));
    expect(posted).toContainEqual(expect.objectContaining({ account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: AMOUNT - 5_000 - 2_500, campaignId: 'campaign-1' }));
    expect(posted).toContainEqual(expect.objectContaining({ account: 'PLATFORM_FEE', direction: 'CREDIT', amount: 2_500 }));
    expect(posted).toContainEqual(expect.objectContaining({ account: 'REFUND_COST', direction: 'CREDIT', amount: 5_000 }));
    expect(allZero(netByAccount(rows))).toBe(true);
  });

  it('reject records status, actor, time and the trimmed reason', async () => {
    const { prisma, tx } = setup({ status: 'REQUESTED', source: 'ESCROW_HOLD' });
    const updateMany = (tx as unknown as { refund: { updateMany: ReturnType<typeof vi.fn> } }).refund.updateMany;

    await rejectRefund(prisma as never, { refundId: 'refund-1', rejectedById: 'admin-2', reason: ' salah input ' });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'refund-1', status: { in: ['REQUESTED', 'AWAITING_DONOR_DETAILS'] } },
      data: expect.objectContaining({ status: 'REJECTED', rejectedById: 'admin-2', rejectedAt: expect.any(Date), rejectionReason: 'salah input' }),
    });
  });

  it('reject also accepts AWAITING_DONOR_DETAILS', async () => {
    const { prisma, rows } = setup({ status: 'AWAITING_DONOR_DETAILS', source: 'ESCROW_HOLD' });
    await rejectRefund(prisma as never, { refundId: 'refund-1', rejectedById: 'admin-2', reason: 'x' });
    expect(allZero(netByAccount(rows))).toBe(true);
  });

  it.each(['APPROVED', 'COMPLETED', 'REJECTED', 'FAILED'])('reject on a %s Refund is a 409 and writes nothing', async (status) => {
    const { prisma, rows, before } = setup({ status, source: 'CAMPAIGN_BALANCE', approved: true });
    await expect(rejectRefund(prisma as never, { refundId: 'refund-1', rejectedById: 'admin-2', reason: 'x' })).rejects.toBeInstanceOf(InvalidRefundStatusError);
    expect(rows).toHaveLength(before);
  });

  it('reject is refused to the requester, to the Campaign Fundraiser, and for a blank reason, writing nothing', async () => {
    const { prisma, rows, before } = setup({ status: 'REQUESTED', source: 'CAMPAIGN_BALANCE' });
    await expect(rejectRefund(prisma as never, { refundId: 'refund-1', rejectedById: 'requester-1', reason: 'x' })).rejects.toBeInstanceOf(RefundResolutionActorError);
    await expect(rejectRefund(prisma as never, { refundId: 'refund-1', rejectedById: 'fundraiser-1', reason: 'x' })).rejects.toBeInstanceOf(OwnSubjectConflictError);
    await expect(rejectRefund(prisma as never, { refundId: 'refund-1', rejectedById: 'admin-2', reason: '   ' })).rejects.toBeInstanceOf(RefundReasonInvalidError);
    expect(rows).toHaveLength(before);
  });

  it('a second reject is a 409 and posts no second journal', async () => {
    const { prisma, rows } = setup({ status: 'REQUESTED', source: 'CAMPAIGN_BALANCE' });
    await rejectRefund(prisma as never, { refundId: 'refund-1', rejectedById: 'admin-2', reason: 'x' });
    const total = rows.length;
    await expect(rejectRefund(prisma as never, { refundId: 'refund-1', rejectedById: 'admin-3', reason: 'x' })).rejects.toBeInstanceOf(InvalidRefundStatusError);
    expect(rows).toHaveLength(total);
  });

  it('fail mirrors freeze and approval: REFUND_CLEARING and every other account return to zero', async () => {
    const { prisma, rows } = setup({ status: 'APPROVED', source: 'CAMPAIGN_BALANCE', approved: true, row: { approvedById: 'approver-1' } });
    expect(netByAccount(rows)['REFUND_CLEARING:']).toBe(AMOUNT);

    await failRefund(prisma as never, { refundId: 'refund-1', failedById: 'admin-3', reason: 'rekening Donor ditutup' });

    expect(netByAccount(rows)['REFUND_CLEARING:']).toBe(0);
    expect(allZero(netByAccount(rows))).toBe(true);
  });

  it('fail covers the shortfall REFUND_COST closed at approval: the top-up is taken back out of the same pool', async () => {
    const { prisma, rows, before } = setup({ status: 'APPROVED', source: 'CAMPAIGN_BALANCE', approved: true, shortfall: 30_000, row: { approvedById: 'approver-1' } });
    expect(rows.some((r) => r.account === 'REFUND_COST' && r.amount === 30_000 && r.direction === 'DEBIT')).toBe(true);

    await failRefund(prisma as never, { refundId: 'refund-1', failedById: 'admin-3', reason: 'x' });

    const posted = rows.slice(before);
    expect(posted).toContainEqual(expect.objectContaining({ account: 'REFUND_COST', direction: 'CREDIT', amount: 30_000 }));
    expect(posted).toContainEqual(expect.objectContaining({ account: 'CAMPAIGN_BALANCE', direction: 'DEBIT', amount: 30_000, campaignId: 'campaign-1' }));
    expect(allZero(netByAccount(rows))).toBe(true);
  });

  it('fail returns to the account the freeze debited even when approval topped up a different one, and releases a share whose escrow already matured', async () => {
    // Frozen from ESCROW_HOLD; by approval the escrow had matured, so the
    // shortfall top-up went to CAMPAIGN_BALANCE. A recomputation from today's
    // Payment would send everything to one pool; the mirror cannot.
    const payment = paymentFor({ escrowReleasedAt: new Date(2026, 0, 1) });
    const subject = { type: 'campaign' as const, campaignId: 'campaign-1' };
    const frozen = rowsOf(
      refundRequestedLegs({ subject, amount: AMOUNT, source: 'ESCROW_HOLD', platformFeePortion: 2_500, providerFeePortion: 5_000 }),
      'refund-requested-refund-1',
    );
    const approved = rowsOf(refundApprovedLegs({ subject, amount: AMOUNT, source: 'CAMPAIGN_BALANCE', shortfall: 10_000 }), 'refund-approved-refund-1');
    const row = refundRow({ status: 'APPROVED', approvedById: 'approver-1', payment });
    const { tx, rows } = makeTx({ ledgerRows: [...frozen, ...approved], refundRow: row, payment });

    await failRefund(makePrisma(tx, row) as never, { refundId: 'refund-1', failedById: 'admin-3', reason: 'x' });

    const net = netByAccount(rows);
    // The ESCROW_HOLD net share was returned and, the escrow having been
    // released, moved on to the withdrawable balance in the same transaction.
    expect(net['CAMPAIGN_BALANCE:campaign-1']).toBe(92_500);
    expect(net['ESCROW_HOLD:campaign-1']).toBe(-92_500); // the Payment's own settlement credit, now released
    expect(net['FROZEN_BALANCE:campaign-1']).toBe(0);
    expect(net['REFUND_CLEARING:']).toBe(0);
  });

  it('fail is refused to the approver and to the Fundraiser, and only an APPROVED Refund can fail', async () => {
    const approved = setup({ status: 'APPROVED', source: 'CAMPAIGN_BALANCE', approved: true, row: { approvedById: 'approver-1' } });
    await expect(failRefund(approved.prisma as never, { refundId: 'refund-1', failedById: 'approver-1', reason: 'x' })).rejects.toBeInstanceOf(RefundResolutionActorError);
    await expect(failRefund(approved.prisma as never, { refundId: 'refund-1', failedById: 'fundraiser-1', reason: 'x' })).rejects.toBeInstanceOf(OwnSubjectConflictError);
    expect(approved.rows).toHaveLength(approved.before);

    for (const status of ['REQUESTED', 'COMPLETED', 'REJECTED', 'FAILED']) {
      const s = setup({ status, source: 'CAMPAIGN_BALANCE', row: { approvedById: 'approver-1' } });
      await expect(failRefund(s.prisma as never, { refundId: 'refund-1', failedById: 'admin-3', reason: 'x' })).rejects.toBeInstanceOf(InvalidRefundStatusError);
      expect(s.rows).toHaveLength(s.before);
    }
  });

  it('a Refund missing its journal is refused rather than mirrored from a guess', async () => {
    const row = refundRow({ status: 'REQUESTED' });
    const { tx, rows } = makeTx({ ledgerRows: [], refundRow: row, payment: paymentFor() });
    await expect(rejectRefund(makePrisma(tx, row) as never, { refundId: 'refund-1', rejectedById: 'admin-2', reason: 'x' })).rejects.toBeInstanceOf(InvalidRefundStatusError);
    expect(rows).toHaveLength(0);
  });
});
