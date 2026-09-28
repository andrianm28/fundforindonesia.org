import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { DEFERRED_ESCROW_WATCHDOG_DAYS } from '@/lib/money/escrow';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Mock prisma wholesale, matching the rest of the money layer's route tests.
// The fake tx below implements ledgerEntry.groupBy/findMany for real, so
// findUnbalancedTransactions and the report's own aggregation run against
// actual rows rather than a hand-fed result.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  manualContributionId?: string | null;
  /** Which payment provider this movement went through; null where unnamed. */
  provider?: string | null;
  providerWithdrawalId?: string | null;
};

type PayoutRow = {
  id: string;
  campaignId: string | null;
  volunteerTripId?: string | null;
  amount: number;
  status: string;
  providerRef: string | null;
  approvedAt: Date | null;
};

type PaymentRow = {
  id: string;
  campaignId?: string;
  volunteerTripId?: string;
  amount?: number;
  providerFee?: number;
  /**
   * Payment.platformFee, the Platform Fee the platform kept (prd-compliance
   * 17). Left optional and passed through to the route untouched, so a
   * fixture can be any of the three shapes this report has to survive: a
   * charged fee (a number), an explicit null, and no field at all. The route
   * reads the last two as 0, the same absence platformFeePortionFor
   * (./ledger.ts) documents for every other reader of this column.
   */
  platformFee?: number | null;
  status?: string;
  escrowReleaseAt?: Date | null;
  escrowReleasedAt?: Date | null;
  registrationStatus?: string;
  /** The donation's Campaign's stored lifecycle status; ACTIVE when omitted. */
  campaignLifecycleStatus?: string;
  /** The donation's Campaign's deadline; none when omitted. */
  campaignDeadline?: Date | null;
};

type RefundRow = {
  id: string;
  paymentId: string;
  status?: string;
  amount?: number;
  reason?: string;
  requestedById?: string;
  createdAt?: Date;
};

type CampaignRow = { id: string; title: string; collectedAmount: number; isDemo?: boolean; kind?: string };

type ProviderWithdrawalRow = {
  id: string;
  provider: string;
  reference: string;
  amount: number;
  destinationName: string;
  collectingEntityId: string | null;
  providerBalanceBefore: number;
  providerBalanceAfter: number;
  proofReference: string;
  recordedById: string;
  recordedAt: Date;
};

type ManualContributionRow = {
  id: string;
  campaignId?: string | null;
  programId?: string | null;
  amount: number;
  proofReference: string;
  recordedById: string;
  status?: string;
  createdAt?: Date;
};

/** Handles the `{ not }` and `{ in }` Prisma filter shapes this route's queries use. */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const rowValue = row[k] ?? null;
    if (v && typeof v === 'object') {
      if ('not' in (v as Record<string, unknown>)) return rowValue !== (v as { not: unknown }).not;
      if ('in' in (v as Record<string, unknown>)) return (v as { in: unknown[] }).in.includes(rowValue);
      if ('lte' in (v as Record<string, unknown>)) {
        return rowValue != null && (rowValue as Date) <= (v as { lte: Date }).lte;
      }
    }
    return rowValue === v;
  });
}

/**
 * Minimal in-memory stand-in for the transaction client the route wraps its
 * whole report in. groupBy is the same simulation used throughout the money
 * layer's tests (src/lib/money/ledger.test.ts and friends).
 */
function makeTx(options: {
  ledgerRows?: LedgerRow[];
  payouts?: PayoutRow[];
  payments?: PaymentRow[];
  refunds?: RefundRow[];
  campaigns?: CampaignRow[];
  manualContributions?: ManualContributionRow[];
  providerWithdrawals?: ProviderWithdrawalRow[];
} = {}) {
  const rows = options.ledgerRows ?? [];
  const payouts = options.payouts ?? [];
  const payments = options.payments ?? [];
  const refunds = options.refunds ?? [];
  const campaigns = options.campaigns ?? [];
  const manualContributions = options.manualContributions ?? [];
  const providerWithdrawals = options.providerWithdrawals ?? [];

  return {
    ledgerEntry: {
      groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
        const filtered = rows.filter((r) => matchesWhere(r as never as Record<string, unknown>, args.where ?? {}));
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
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => matchesWhere(r as never as Record<string, unknown>, where)),
      ),
    },
    payment: {
      // Backs two different call shapes in the route: `id: { in: [...] }`
      // (PROVIDER_FEE attribution) and `escrowReleasedAt: { not: null }`
      // (the strandedEscrow safety net) -- matchesWhere handles both, and
      // returning every field regardless of which `select` was requested is
      // harmless since each call site only reads the fields it asked for.
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Default escrowReleasedAt to null (as a real, unreleased Payment
        // row would have) rather than leaving it undefined, so `{ not: null
        // }` correctly excludes a fixture that never mentioned the field.
        // donationId/registrationId are also computed here, before
        // filtering, so a `where` clause on either (e.g.
        // `registrationId: { not: null }`, the orphanedCancelledRegistration
        // Payments query) matches against them the same way Prisma would
        // against real columns, not just the raw fixture's proxy fields.
        const normalized = payments.map((p) => {
          const isTrip = p.volunteerTripId != null;
          const isCampaign = p.campaignId != null;
          return {
            ...p,
            escrowReleasedAt: p.escrowReleasedAt ?? null,
            donationId: isCampaign ? `donation-for-${p.id}` : null,
            registrationId: isTrip ? `registration-for-${p.id}` : null,
          };
        });
        return normalized
          .filter((p) => matchesWhere(p as never as Record<string, unknown>, where))
          .map((p) => {
            // A payment fixture is registration-linked (Trip Fee) when it
            // sets volunteerTripId instead of campaignId -- mirrors the
            // real schema's exactly-one-of donationId/registrationId. A
            // fixture with neither set simulates the anomalous, no-subject
            // row assertExactlyOnePaymentSubject should have prevented at
            // creation (reconcile's subjectlessPayments safety net).
            const isTrip = p.volunteerTripId != null;
            const isCampaign = p.campaignId != null;
            return {
              id: p.id,
              amount: p.amount ?? 0,
              providerFee: p.providerFee ?? 0,
              // Passed through raw -- undefined for a fixture that never
              // mentions the field, exactly as a Prisma row would look if the
              // field were not selected -- rather than defaulted to 0 like
              // amount and providerFee above. That is the input that matters:
              // `x - undefined` is NaN, where `x - null` quietly coerces to 0
              // and needs no guard at all, so a harness that supplied 0 (or
              // null) here would let an unguarded subtraction read as green
              // here while the report emitted `residual: null` for real.
              platformFee: p.platformFee,
              escrowReleaseAt: p.escrowReleaseAt ?? null,
              donationId: p.donationId,
              registrationId: p.registrationId,
              donation: isCampaign
                ? {
                    campaignId: p.campaignId,
                    campaign: {
                      lifecycleStatus: p.campaignLifecycleStatus ?? 'ACTIVE',
                      deadline: p.campaignDeadline ?? null,
                    },
                  }
                : null,
              registration: isTrip ? { status: p.registrationStatus ?? 'CONFIRMED', batch: { tripId: p.volunteerTripId } } : null,
              // Nested relation select, backing the deferredEscrowWatchdog
              // query -- reads off the same `refunds` fixture array
              // refund.findMany below reads, joined by paymentId.
              refunds: refunds
                .filter((r) => r.paymentId === p.id)
                .map((r) => ({ id: r.id, status: r.status ?? 'REQUESTED' })),
            };
          });
      }),
    },
    refund: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        refunds
          .filter((r) => matchesWhere(r as never as Record<string, unknown>, where))
          .map((r) => {
            const payment = payments.find((p) => p.id === r.paymentId);
            const isTrip = payment?.volunteerTripId != null;
            const isCampaign = payment?.campaignId != null;
            return {
              id: r.id,
              paymentId: r.paymentId,
              amount: r.amount ?? 0,
              reason: r.reason ?? 'Test refund reason',
              requestedById: r.requestedById ?? 'requester-1',
              createdAt: r.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
              payment: payment
                ? {
                    donationId: isCampaign ? `donation-for-${payment.id}` : null,
                    registrationId: isTrip ? `registration-for-${payment.id}` : null,
                    donation: isCampaign ? { campaignId: payment.campaignId } : null,
                    registration: isTrip ? { batch: { tripId: payment.volunteerTripId } } : null,
                  }
                : null,
            };
          }),
      ),
    },
    campaign: {
      // Defaults `kind` to DONATION, as the column does, so a fixture that
      // never mentions it is an ordinary social-fundraising Campaign rather than
      // one whose `kind: 'DONATION'` predicate silently matches nothing.
      findMany: vi.fn(async () => campaigns.map((c) => ({ ...c, kind: c.kind ?? 'DONATION' }))),
    },
    donation: {
      // A Donation only ever exists as the subject of a Payment, so the fake
      // derives them from the payments fixture using the same
      // `donation-for-<paymentId>` convention payment.findMany above already
      // uses, rather than asking every test to spell out a second fixture list.
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        payments
          .filter((p) => p.campaignId != null)
          .map((p) => ({ id: `donation-for-${p.id}`, campaignId: p.campaignId }))
          .filter((d) => matchesWhere(d as never as Record<string, unknown>, where)),
      ),
    },
    providerWithdrawal: {
      // `where` is optional the way it is in Prisma: the per-provider
      // reconciliation asks for every recorded sweep and only supplies an
      // orderBy, so the fake has to treat a missing filter as no filter rather
      // than reaching for undefined.
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        providerWithdrawals.filter((w) => matchesWhere(w as never as Record<string, unknown>, where ?? {})),
      ),
    },
    manualContribution: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // status defaults to PENDING, as the column does, so a fixture that
        // never mentions it is a real queued contribution rather than a row
        // whose `status: 'PENDING'` predicate silently matches nothing.
        const normalized = manualContributions.map((m) => ({
          campaignId: null,
          programId: null,
          ...m,
          status: m.status ?? 'PENDING',
          createdAt: m.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
        }));
        return normalized.filter((m) => matchesWhere(m as never as Record<string, unknown>, where));
      }),
    },
    payout: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        payouts
          .filter((p) => matchesWhere(p as never as Record<string, unknown>, where))
          .map((p) => ({
            id: p.id,
            campaignId: p.campaignId,
            volunteerTripId: p.volunteerTripId ?? null,
            amount: p.amount,
            providerRef: p.providerRef,
            approvedAt: p.approvedAt,
          })),
      ),
    },
  };
}

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/reconcile');
}

describe('GET /api/admin/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', assignments: ['VERIFIER'] } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment', async () => {
    // The exact scenario ADR 0005 exists to fix: rank alone must never
    // substitute for the assignment this route requires.
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-1', assignments: [] } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('reports a clean ledger as clean', async () => {
    const tx = makeTx({
      ledgerRows: [
        // A real paymentSettledLegs shape: balanced (debit = credit).
        { transactionId: 't1', direction: 'DEBIT', amount: 100_000, account: 'GATEWAY_CLEARING', campaignId: null },
        { transactionId: 't1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1' },
      ],
      campaigns: [{ id: 'campaign-1', title: 'Campaign One', collectedAmount: 100_000 }],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.unbalancedTransactions).toEqual([]);
    expect(data.negativeBalances).toEqual([]);
    expect(data.preLedger).toEqual([]);
    expect(data.mismatches).toEqual([]);
    expect(typeof data.caveat).toBe('string');
    expect(data.strandedEscrow).toEqual([]);
    expect(data.stuckPayouts.processing).toEqual([]);
    expect(data.stuckPayouts.approvedWithoutProviderRef).toEqual([]);
  });

  it('reports an unbalanced transaction written outside postTransaction', async () => {
    const tx = makeTx({
      ledgerRows: [
        // A lone DEBIT with no matching CREDIT -- postTransaction itself
        // would refuse to post this; its presence means something bypassed
        // it entirely.
        { transactionId: 'bad-1', direction: 'DEBIT', amount: 50_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.unbalancedTransactions).toEqual([
      { transactionId: 'bad-1', debits: 50_000, credits: 0 },
    ]);
  });

  it('reports a negative CAMPAIGN_BALANCE', async () => {
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'DEBIT', amount: 10_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.negativeBalances).toEqual([
      { campaignId: 'campaign-1', account: 'CAMPAIGN_BALANCE', balance: -10_000 },
    ]);
  });

  it('reports, as a real mismatch, a campaign with ledger activity whose collectedAmount still disagrees -- attributing PROVIDER_FEE via the payment it names', async () => {
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'CREDIT', amount: 95_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1' },
        { transactionId: 't1', direction: 'CREDIT', amount: 5_000, account: 'PROVIDER_FEE', campaignId: null, paymentId: 'payment-1' },
      ],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      // The ledger says this campaign's gross was 95_000 + 5_000 = 100_000,
      // but collectedAmount says 130_000 -- this campaign genuinely has
      // ledger activity (the ESCROW_HOLD credit), so the extra 30_000 is a
      // real finding, not pre-ledger noise.
      campaigns: [{ id: 'campaign-1', title: 'Campaign One', collectedAmount: 130_000 }],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.mismatches).toEqual([
      {
        campaignId: 'campaign-1',
        campaignTitle: 'Campaign One',
        collectedAmount: 130_000,
        ledgerAmount: 100_000,
        difference: 30_000,
      },
    ]);
    expect(data.preLedger).toEqual([]);
  });

  it('excludes a Registration-linked payment\'s PROVIDER_FEE leg from feeByCampaign instead of crashing', async () => {
    // A real Trip Fee payment's PROVIDER_FEE ledger leg is posted whenever
    // providerFee > 0 -- this payment has no donation, only a registration,
    // so p.donation is null and the old unconditional p.donation.campaignId
    // read would throw a TypeError here.
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'CREDIT', amount: 5_000, account: 'PROVIDER_FEE', campaignId: null, paymentId: 'payment-1' },
      ],
      payments: [{ id: 'payment-1', volunteerTripId: 'trip-1' }],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.mismatches).toEqual([]);
    expect(data.preLedger).toEqual([]);
  });

  it('partitions a campaign with collectedAmount > 0 and no ledger entries at all into preLedger, not mismatches', async () => {
    const tx = makeTx({
      ledgerRows: [],
      // e.g. a campaign funded entirely through /api/balance/donate, which
      // bumps collectedAmount and never touches the ledger.
      campaigns: [{ id: 'campaign-1', title: 'Wallet-funded Campaign', collectedAmount: 500_000 }],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.preLedger).toEqual([
      {
        campaignId: 'campaign-1',
        campaignTitle: 'Wallet-funded Campaign',
        collectedAmount: 500_000,
        ledgerAmount: 0,
        difference: 500_000,
      },
    ]);
    expect(data.mismatches).toEqual([]);
    expect(data.caveat).toMatch(/preLedger/);
  });

  it('excludes an isDemo campaign from preLedger entirely, even though it has collectedAmount and no ledger rows -- the exact shape the M9 migration produces', async () => {
    const tx = makeTx({
      ledgerRows: [],
      campaigns: [
        { id: 'demo-1', title: 'Bantu Korban Bencana (contoh)', collectedAmount: 25_000_000, isDemo: true },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    // Not preLedger either -- belt-and-braces on top of that partition, not
    // routed through it. This is the number that proves task M9 worked: on
    // the live database, every one of the 30 demo campaigns would otherwise
    // have landed here.
    expect(data.preLedger).toEqual([]);
    expect(data.mismatches).toEqual([]);
  });

  it('reconstructs a campaign\'s gross with its Platform Fee included -- and still reports a campaign that really disagrees', async () => {
    // Campaign.collectedAmount is written as the GROSS (webhooks/[provider]
    // increments it by payment.amount), while the ledger splits that gross
    // three ways: ESCROW_HOLD gets the net, PROVIDER_FEE and PLATFORM_FEE get
    // their own shares. Adding back only the Provider Fee left the Platform
    // Fee out of the reconstruction, so every campaign that charged one was
    // reported here as a permanent mismatch of exactly that fee -- on every
    // single run, for every campaign, which is what makes a report like this
    // unusable rather than merely noisy.
    //
    // campaign-2 is the control: byte-identical ledger to campaign-1's, the
    // only difference being a collectedAmount that really is wrong, and it is
    // still reported -- 30_000 off, not 2_500, which is the number that shows
    // the fee is now reconstructed rather than the check quietly skipped.
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'DEBIT', amount: 100_000, account: 'GATEWAY_CLEARING', campaignId: null },
        { transactionId: 't1', direction: 'CREDIT', amount: 92_500, account: 'ESCROW_HOLD', campaignId: 'campaign-1' },
        { transactionId: 't1', direction: 'CREDIT', amount: 5_000, account: 'PROVIDER_FEE', campaignId: null, paymentId: 'payment-1' },
        { transactionId: 't1', direction: 'CREDIT', amount: 2_500, account: 'PLATFORM_FEE', campaignId: null, paymentId: 'payment-1' },
        { transactionId: 't2', direction: 'DEBIT', amount: 100_000, account: 'GATEWAY_CLEARING', campaignId: null },
        { transactionId: 't2', direction: 'CREDIT', amount: 92_500, account: 'ESCROW_HOLD', campaignId: 'campaign-2' },
        { transactionId: 't2', direction: 'CREDIT', amount: 5_000, account: 'PROVIDER_FEE', campaignId: null, paymentId: 'payment-2' },
        { transactionId: 't2', direction: 'CREDIT', amount: 2_500, account: 'PLATFORM_FEE', campaignId: null, paymentId: 'payment-2' },
      ],
      payments: [
        { id: 'payment-1', campaignId: 'campaign-1', amount: 100_000, providerFee: 5_000, platformFee: 2_500 },
        { id: 'payment-2', campaignId: 'campaign-2', amount: 100_000, providerFee: 5_000, platformFee: 2_500 },
      ],
      campaigns: [
        { id: 'campaign-1', title: 'Charged a Platform Fee, collectedAmount correct', collectedAmount: 100_000 },
        { id: 'campaign-2', title: 'Charged a Platform Fee, collectedAmount wrong', collectedAmount: 130_000 },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.mismatches).toEqual([
      {
        campaignId: 'campaign-2',
        campaignTitle: 'Charged a Platform Fee, collectedAmount wrong',
        collectedAmount: 130_000,
        ledgerAmount: 100_000,
        difference: 30_000,
      },
    ]);
    expect(data.preLedger).toEqual([]);
  });

  it('still reports a real mismatch on a non-demo campaign sitting alongside an excluded isDemo one', async () => {
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1' },
      ],
      campaigns: [
        { id: 'campaign-1', title: 'Real Campaign', collectedAmount: 999_999, isDemo: false },
        { id: 'demo-1', title: 'Demo Campaign', collectedAmount: 25_000_000, isDemo: true },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.mismatches).toEqual([
      {
        campaignId: 'campaign-1',
        campaignTitle: 'Real Campaign',
        collectedAmount: 999_999,
        ledgerAmount: 100_000,
        difference: 899_999,
      },
    ]);
    expect(data.preLedger).toEqual([]);
  });

  it('does not flag a payment that released cleanly (its DEBIT ESCROW_HOLD leg accounts for the full net)', async () => {
    const tx = makeTx({
      ledgerRows: [
        {
          transactionId: 'escrow-release:payment-1',
          direction: 'DEBIT',
          amount: 100_000,
          account: 'ESCROW_HOLD',
          campaignId: 'campaign-1',
          paymentId: 'payment-1',
        },
        {
          transactionId: 'escrow-release:payment-1',
          direction: 'CREDIT',
          amount: 100_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
        },
      ],
      payments: [
        { id: 'payment-1', campaignId: 'campaign-1', amount: 100_000, providerFee: 0, escrowReleasedAt: new Date('2026-08-10') },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.strandedEscrow).toEqual([]);
  });

  it('computes a released payment\'s credited net as Gross minus BOTH fees -- and still flags one whose net is genuinely short', async () => {
    // The paired half of the escrow.ts fix. paymentSettledLegs credits
    // ESCROW_HOLD 92_500 for a 100_000 Payment that kept 5_000 to the provider
    // and 2_500 to the platform, and releaseMaturedEscrow releases that same
    // 92_500. A reconcile that read only `amount - providerFee` would credit
    // this payment with a 95_000 net, find 92_500 released, and report a
    // 2_500 residual -- i.e. flag every single Platform-Fee Payment ever
    // released as stranded escrow, forever, with nothing an admin could do.
    //
    // payment-2 is the control that this is a real comparison and not a
    // suppressed alarm: same shape, same fees, but only 90_000 of its 92_500
    // net ever left escrow, and it is reported -- with a residual of exactly
    // the 2_500 still sitting there, which is the number that proves the net
    // was computed with the Platform Fee subtracted.
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'DEBIT', amount: 100_000, account: 'GATEWAY_CLEARING', campaignId: null },
        { transactionId: 't1', direction: 'CREDIT', amount: 92_500, account: 'ESCROW_HOLD', campaignId: 'campaign-1' },
        { transactionId: 't1', direction: 'CREDIT', amount: 5_000, account: 'PROVIDER_FEE', campaignId: null, paymentId: 'payment-1' },
        { transactionId: 't1', direction: 'CREDIT', amount: 2_500, account: 'PLATFORM_FEE', campaignId: null, paymentId: 'payment-1' },
        {
          transactionId: 'escrow-release:payment-1',
          direction: 'DEBIT',
          amount: 92_500,
          account: 'ESCROW_HOLD',
          campaignId: 'campaign-1',
          paymentId: 'payment-1',
        },
        { transactionId: 'escrow-release:payment-1', direction: 'CREDIT', amount: 92_500, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
        // payment-2 released 2_500 short of its net and was never refunded.
        {
          transactionId: 'escrow-release:payment-2',
          direction: 'DEBIT',
          amount: 90_000,
          account: 'ESCROW_HOLD',
          campaignId: 'campaign-2',
          paymentId: 'payment-2',
        },
        { transactionId: 'escrow-release:payment-2', direction: 'CREDIT', amount: 90_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-2' },
      ],
      payments: [
        { id: 'payment-1', campaignId: 'campaign-1', amount: 100_000, providerFee: 5_000, platformFee: 2_500, escrowReleasedAt: new Date('2026-08-10') },
        { id: 'payment-2', campaignId: 'campaign-2', amount: 100_000, providerFee: 5_000, platformFee: 2_500, escrowReleasedAt: new Date('2026-08-10') },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.strandedEscrow).toEqual([
      {
        paymentId: 'payment-2',
        campaignId: 'campaign-2',
        creditedNet: 92_500,
        releasedAmount: 90_000,
        refundedAmount: 0,
        residual: 2_500,
      },
    ]);
  });

  it('reads a missing or null platformFee as no Platform Fee at all -- never as a NaN residual that hides a stranded payment', async () => {
    // Two failures from one unguarded subtraction, both asserted here -- and
    // only the first is the interesting one, because `100_000 - null` is
    // 95_000 and needs no guard at all. It is the *absent* field that is
    // poisonous: `x - undefined` is NaN, and NaN compares unequal to 0 in
    // both directions, so a residual can never read as settled.
    //
    // payment-1 (no platformFee field at all, as a row whose select never
    // asked for one would look): released in full at 95_000, so it must be
    // silent. Under the NaN arithmetic it would be reported as stranded,
    // with a residual that serialises to `null` -- an incident an admin can
    // neither size nor trust.
    //
    // payment-2 (an explicit null, which does coerce): genuinely stranded,
    // and it must still be reported, with its true 100_000 intact.
    const tx = makeTx({
      ledgerRows: [
        {
          transactionId: 'escrow-release:payment-1',
          direction: 'DEBIT',
          amount: 95_000,
          account: 'ESCROW_HOLD',
          campaignId: 'campaign-1',
          paymentId: 'payment-1',
        },
        { transactionId: 'escrow-release:payment-1', direction: 'CREDIT', amount: 95_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
      ],
      payments: [
        // platformFee omitted entirely: this report walks historical rows,
        // and platformFeePortionFor (./ledger.ts) documents a missing one as
        // 0 rather than as a reason to refuse.
        { id: 'payment-1', campaignId: 'campaign-1', amount: 100_000, providerFee: 5_000, escrowReleasedAt: new Date('2026-08-10') },
        { id: 'payment-2', campaignId: 'campaign-2', amount: 100_000, providerFee: 0, platformFee: null, escrowReleasedAt: new Date('2026-08-10') },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.strandedEscrow).toEqual([
      {
        paymentId: 'payment-2',
        campaignId: 'campaign-2',
        creditedNet: 100_000,
        releasedAmount: 0,
        refundedAmount: 0,
        residual: 100_000,
      },
    ]);
  });

  it('does not flag a payment that was fully and finally refunded (refund debit accounts for the full net)', async () => {
    const tx = makeTx({
      ledgerRows: [
        {
          transactionId: 'refund-1',
          direction: 'DEBIT',
          amount: 100_000,
          account: 'ESCROW_HOLD',
          campaignId: 'campaign-1',
          refundId: 'refund-1',
        },
        { transactionId: 'refund-1', direction: 'CREDIT', amount: 100_000, account: 'REFUND_CLEARING', campaignId: null },
      ],
      payments: [
        { id: 'payment-1', campaignId: 'campaign-1', amount: 100_000, providerFee: 0, escrowReleasedAt: new Date('2026-08-10') },
      ],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.strandedEscrow).toEqual([]);
  });

  it('flags a payment stamped escrowReleasedAt whose net was neither released nor refunded -- the stranding bug', async () => {
    // The exact shape the fixed bug in escrow.ts used to leave behind: a
    // payment claimed and stamped `escrowReleasedAt`, but with no release
    // leg posted (its own refund was in flight when the stamp happened) and
    // no refund debit either (that refund never resolved, or was silently
    // lost) -- its 100_000 net is sitting in ESCROW_HOLD, unreachable by any
    // future sweep.
    const tx = makeTx({
      ledgerRows: [],
      payments: [
        { id: 'payment-1', campaignId: 'campaign-1', amount: 100_000, providerFee: 0, escrowReleasedAt: new Date('2026-08-10') },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.strandedEscrow).toEqual([
      {
        paymentId: 'payment-1',
        campaignId: 'campaign-1',
        creditedNet: 100_000,
        releasedAmount: 0,
        refundedAmount: 0,
        residual: 100_000,
      },
    ]);
  });

  it('flags a payment whose escrow matured well past the watchdog window and is still unreleased, naming its stuck refund', async () => {
    const longOverdue = new Date(Date.now() - (DEFERRED_ESCROW_WATCHDOG_DAYS + 1) * MS_PER_DAY);
    const tx = makeTx({
      payments: [
        {
          id: 'payment-1',
          campaignId: 'campaign-1',
          amount: 100_000,
          status: 'PAID',
          escrowReleaseAt: longOverdue,
          escrowReleasedAt: null,
        },
      ],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1', status: 'REQUESTED' }],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.deferredEscrowWatchdog).toEqual([
      {
        paymentId: 'payment-1',
        campaignId: 'campaign-1',
        escrowReleaseAt: longOverdue.toISOString(),
        refunds: [{ refundId: 'refund-1', status: 'REQUESTED' }],
      },
    ]);
  });

  it('keeps reporting a Suspended Campaign\'s held payment, labelled with the Suspension as its cause', async () => {
    const longOverdue = new Date(Date.now() - (DEFERRED_ESCROW_WATCHDOG_DAYS + 1) * MS_PER_DAY);
    const tx = makeTx({
      payments: [
        {
          id: 'payment-1',
          campaignId: 'campaign-1',
          campaignLifecycleStatus: 'SUSPENDED',
          amount: 100_000,
          status: 'PAID',
          escrowReleaseAt: longOverdue,
          escrowReleasedAt: null,
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.deferredEscrowWatchdog).toEqual([
      {
        paymentId: 'payment-1',
        campaignId: 'campaign-1',
        escrowReleaseAt: longOverdue.toISOString(),
        refunds: [],
        cause: 'SUSPENDED',
      },
    ]);
  });

  it('leaves an unexplained held payment (no in-flight refund, Campaign not Suspended) without a cause, even when the Campaign is effectively Expired', async () => {
    const longOverdue = new Date(Date.now() - (DEFERRED_ESCROW_WATCHDOG_DAYS + 1) * MS_PER_DAY);
    const tx = makeTx({
      payments: [
        {
          id: 'payment-1',
          campaignId: 'campaign-1',
          campaignLifecycleStatus: 'ACTIVE',
          campaignDeadline: longOverdue,
          amount: 100_000,
          status: 'PAID',
          escrowReleaseAt: longOverdue,
          escrowReleasedAt: null,
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.deferredEscrowWatchdog).toEqual([
      {
        paymentId: 'payment-1',
        campaignId: 'campaign-1',
        escrowReleaseAt: longOverdue.toISOString(),
        refunds: [],
      },
    ]);
    expect(data.deferredEscrowWatchdog[0]).not.toHaveProperty('cause');
  });

  it('does not flag a payment still well inside the watchdog grace window', async () => {
    const recentlyMatured = new Date(Date.now() - 1 * MS_PER_DAY);
    const tx = makeTx({
      payments: [
        {
          id: 'payment-1',
          campaignId: 'campaign-1',
          amount: 100_000,
          status: 'PAID',
          escrowReleaseAt: recentlyMatured,
          escrowReleasedAt: null,
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.deferredEscrowWatchdog).toEqual([]);
  });

  it('does not flag a payment that already released cleanly, even long ago', async () => {
    const longOverdue = new Date(Date.now() - (DEFERRED_ESCROW_WATCHDOG_DAYS + 1) * MS_PER_DAY);
    const tx = makeTx({
      payments: [
        {
          id: 'payment-1',
          campaignId: 'campaign-1',
          amount: 100_000,
          status: 'PAID',
          escrowReleaseAt: longOverdue,
          escrowReleasedAt: longOverdue,
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.deferredEscrowWatchdog).toEqual([]);
  });

  it('lists a stuck PROCESSING payout', async () => {
    const tx = makeTx({
      payouts: [
        {
          id: 'payout-1',
          campaignId: 'campaign-1',
          amount: 200_000,
          status: 'PROCESSING',
          providerRef: 'provider-ref-1',
          approvedAt: new Date('2026-08-01'),
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.stuckPayouts.processing).toEqual([
      {
        payoutId: 'payout-1',
        campaignId: 'campaign-1',
        volunteerTripId: null,
        amount: 200_000,
        providerRef: 'provider-ref-1',
        approvedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    expect(data.stuckPayouts.approvedWithoutProviderRef).toEqual([]);
  });

  it('lists an APPROVED payout with legs posted and no providerRef', async () => {
    const tx = makeTx({
      payouts: [
        {
          id: 'payout-2',
          campaignId: 'campaign-1',
          amount: 75_000,
          status: 'APPROVED',
          providerRef: null,
          approvedAt: new Date('2026-08-05'),
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.stuckPayouts.approvedWithoutProviderRef).toEqual([
      {
        payoutId: 'payout-2',
        campaignId: 'campaign-1',
        volunteerTripId: null,
        amount: 75_000,
        approvedAt: '2026-08-05T00:00:00.000Z',
      },
    ]);
    expect(data.stuckPayouts.processing).toEqual([]);
  });

  it('stops listing a COMPLETED payout as outstanding work', async () => {
    // A Payout the second Admin has already recorded with proof of transfer
    // is finished. It used to be unlistable-in-principle only because
    // nothing could write COMPLETED; now the endpoint exists, and a
    // completed payout appearing in the work queue would be an operator
    // chasing money that has already gone.
    const tx = makeTx({
      payouts: [
        {
          id: 'payout-3',
          campaignId: 'campaign-1',
          amount: 75_000,
          status: 'COMPLETED',
          providerRef: null,
          approvedAt: new Date('2026-08-05'),
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.stuckPayouts.approvedWithoutProviderRef).toEqual([]);
    expect(data.stuckPayouts.processing).toEqual([]);
  });

  it('lists a Campaign-linked REQUESTED refund in pendingRefunds', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1', status: 'REQUESTED', amount: 50_000, reason: 'Donor overpaid', requestedById: 'admin-1', createdAt: new Date('2026-02-01T00:00:00.000Z') }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.pendingRefunds).toEqual([
      {
        refundId: 'refund-1',
        paymentId: 'payment-1',
        amount: 50_000,
        reason: 'Donor overpaid',
        requestedById: 'admin-1',
        createdAt: '2026-02-01T00:00:00.000Z',
        campaignId: 'campaign-1',
        volunteerTripId: null,
      },
    ]);
  });

  it('lists a Trip-linked REQUESTED refund in pendingRefunds', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-2', volunteerTripId: 'trip-1' }],
      refunds: [{ id: 'refund-2', paymentId: 'payment-2', status: 'REQUESTED', amount: 250_000, reason: 'Registration cancelled', requestedById: 'volunteer-1', createdAt: new Date('2026-02-02T00:00:00.000Z') }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.pendingRefunds).toEqual([
      {
        refundId: 'refund-2',
        paymentId: 'payment-2',
        amount: 250_000,
        reason: 'Registration cancelled',
        requestedById: 'volunteer-1',
        createdAt: '2026-02-02T00:00:00.000Z',
        campaignId: null,
        volunteerTripId: 'trip-1',
      },
    ]);
  });

  it('excludes a Refund that is not REQUESTED from pendingRefunds', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-3', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-3', paymentId: 'payment-3', status: 'APPROVED', amount: 10_000 }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.pendingRefunds).toEqual([]);
  });

  it('returns an empty pendingRefunds array, not an absent field, when there are no pending refunds', async () => {
    const tx = makeTx({});
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.pendingRefunds).toEqual([]);
  });

  it('lists a PAID Trip Payment whose Registration is CANCELLED and has no live Refund in orphanedCancelledRegistrationPayments', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-4', volunteerTripId: 'trip-1', status: 'PAID', registrationStatus: 'CANCELLED' }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.orphanedCancelledRegistrationPayments).toEqual([
      { paymentId: 'payment-4', registrationId: 'registration-for-payment-4', volunteerTripId: 'trip-1' },
    ]);
  });

  it('excludes a CANCELLED Registration Payment from orphanedCancelledRegistrationPayments when a live Refund already covers it', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-5', volunteerTripId: 'trip-1', status: 'PAID', registrationStatus: 'CANCELLED' }],
      refunds: [{ id: 'refund-5', paymentId: 'payment-5', status: 'REQUESTED' }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.orphanedCancelledRegistrationPayments).toEqual([]);
  });

  it('still lists a CANCELLED Registration Payment when its only Refund is REJECTED', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-6', volunteerTripId: 'trip-1', status: 'PAID', registrationStatus: 'CANCELLED' }],
      refunds: [{ id: 'refund-6', paymentId: 'payment-6', status: 'REJECTED' }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.orphanedCancelledRegistrationPayments).toEqual([
      { paymentId: 'payment-6', registrationId: 'registration-for-payment-6', volunteerTripId: 'trip-1' },
    ]);
  });

  it('does not list a PAID Trip Payment whose Registration is normally CONFIRMED', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-7', volunteerTripId: 'trip-1', status: 'PAID' }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.orphanedCancelledRegistrationPayments).toEqual([]);
  });
});

describe('GET /api/admin/reconcile -- Manual Contributions (prd-compliance 34)', () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  it('lists the ones still waiting for a second Admin, as a work queue', async () => {
    // The two-person rule is only operable if the second Admin can find what
    // is waiting for them. Nothing else in this report makes a PENDING
    // Manual Contribution discoverable.
    const tx = makeTx({
      manualContributions: [
        { id: 'mc-1', campaignId: 'campaign-1', amount: 250_000, proofReference: 'bukti.pdf', recordedById: 'admin-1' },
        { id: 'mc-2', programId: 'program-1', amount: 500_000_000, proofReference: 'invoice.pdf', recordedById: 'admin-3' },
      ],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.pendingManualContributions).toEqual([
      {
        manualContributionId: 'mc-1',
        campaignId: 'campaign-1',
        programId: null,
        amount: 250_000,
        proofReference: 'bukti.pdf',
        recordedById: 'admin-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        manualContributionId: 'mc-2',
        campaignId: null,
        programId: 'program-1',
        amount: 500_000_000,
        proofReference: 'invoice.pdf',
        recordedById: 'admin-3',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('excludes an already-decided contribution from that queue', async () => {
    for (const status of ['APPROVED', 'REJECTED', 'REVERSED']) {
      const tx = makeTx({
        manualContributions: [
          { id: 'mc-1', campaignId: 'campaign-1', amount: 250_000, proofReference: 'bukti.pdf', recordedById: 'admin-1', status },
        ],
      });
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      const body = await (await GET(createRequest())).json();

      expect(body.pendingManualContributions).toEqual([]);
    }
  });

  it('does not flag a Campaign whose only money arrived off-gateway', async () => {
    // collectedAmount was incremented by the approval, in the same
    // transaction as the ledger. Reconciling it against ESCROW_HOLD credits
    // alone would call every Manual Contribution a permanent mismatch.
    const tx = makeTx({
      campaigns: [{ id: 'campaign-1', title: 'Pemulihan Gudang', collectedAmount: 250_000 }],
      ledgerRows: [
        {
          transactionId: 'manual-contribution-mc-1',
          direction: 'CREDIT',
          amount: 250_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
          manualContributionId: 'mc-1',
        },
        {
          transactionId: 'manual-contribution-mc-1',
          direction: 'DEBIT',
          amount: 250_000,
          account: 'MANUAL_INTAKE_CLEARING',
          campaignId: null,
          manualContributionId: 'mc-1',
        },
      ],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const body = await (await GET(createRequest())).json();

    expect(body.mismatches).toEqual([]);
    expect(body.preLedger).toEqual([]);
  });

  it('takes a reversed contribution back out of the reconciliation, not just out of the balance', async () => {
    const tx = makeTx({
      campaigns: [{ id: 'campaign-1', title: 'Pemulihan Gudang', collectedAmount: 0 }],
      ledgerRows: [
        {
          transactionId: 'manual-contribution-mc-1',
          direction: 'CREDIT',
          amount: 250_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
          manualContributionId: 'mc-1',
        },
        {
          transactionId: 'manual-contribution-reversed-mc-1',
          direction: 'DEBIT',
          amount: 250_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
          manualContributionId: 'mc-1',
        },
        {
          transactionId: 'manual-contribution-mc-1',
          direction: 'DEBIT',
          amount: 250_000,
          account: 'MANUAL_INTAKE_CLEARING',
          campaignId: null,
          manualContributionId: 'mc-1',
        },
        {
          transactionId: 'manual-contribution-reversed-mc-1',
          direction: 'CREDIT',
          amount: 250_000,
          account: 'MANUAL_INTAKE_CLEARING',
          campaignId: null,
          manualContributionId: 'mc-1',
        },
      ],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const body = await (await GET(createRequest())).json();

    expect(body.mismatches).toEqual([]);
  });

  it('never reports a Program as a Campaign with no ledger, however much it holds', async () => {
    const tx = makeTx({
      campaigns: [{ id: 'campaign-1', title: 'Pemulihan Gudang', collectedAmount: 0 }],
      ledgerRows: [
        {
          transactionId: 'manual-contribution-mc-9',
          direction: 'CREDIT',
          amount: 500_000_000,
          account: 'PROGRAM_BALANCE',
          campaignId: null,
          volunteerTripId: null,
          manualContributionId: 'mc-9',
        },
        {
          transactionId: 'manual-contribution-mc-9',
          direction: 'DEBIT',
          amount: 500_000_000,
          account: 'MANUAL_INTAKE_CLEARING',
          campaignId: null,
          manualContributionId: 'mc-9',
        },
      ],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const body = await (await GET(createRequest())).json();

    expect(body.mismatches).toEqual([]);
    expect(body.preLedger).toEqual([]);
  });
});

describe('GET /api/admin/reconcile -- trip-scoped checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  it('reports an empty tripNegativeBalances when there are no trip-scoped ledger entries at all', async () => {
    const tx = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripNegativeBalances).toEqual([]);
  });

  it('flags a trip whose ESCROW_HOLD balance is negative', async () => {
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'DEBIT', amount: 10_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripNegativeBalances).toEqual([
      { volunteerTripId: 'trip-1', account: 'ESCROW_HOLD', balance: -10_000 },
    ]);
  });

  it('does not flag a trip whose balance is positive', async () => {
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'CREDIT', amount: 10_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-2' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripNegativeBalances).toEqual([]);
  });

  it('does not let a campaign-scoped negative balance leak into tripNegativeBalances', async () => {
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'DEBIT', amount: 10_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripNegativeBalances).toEqual([]);
    expect(data.negativeBalances).toEqual([
      { campaignId: 'campaign-1', account: 'CAMPAIGN_BALANCE', balance: -10_000 },
    ]);
  });

  it('includes volunteerTripId on a stuck PROCESSING payout that belongs to a trip', async () => {
    const tx = makeTx({
      payouts: [
        {
          id: 'payout-3',
          campaignId: null,
          volunteerTripId: 'trip-3',
          amount: 60_000,
          status: 'PROCESSING',
          providerRef: 'provider-ref-3',
          approvedAt: new Date('2026-09-01'),
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.stuckPayouts.processing).toEqual([
      {
        payoutId: 'payout-3',
        campaignId: null,
        volunteerTripId: 'trip-3',
        amount: 60_000,
        providerRef: 'provider-ref-3',
        approvedAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
  });

  it('includes volunteerTripId on an approved-without-providerRef payout that belongs to a trip', async () => {
    const tx = makeTx({
      payouts: [
        {
          id: 'payout-4',
          campaignId: null,
          volunteerTripId: 'trip-4',
          amount: 25_000,
          status: 'APPROVED',
          providerRef: null,
          approvedAt: new Date('2026-09-02'),
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.stuckPayouts.approvedWithoutProviderRef).toEqual([
      {
        payoutId: 'payout-4',
        campaignId: null,
        volunteerTripId: 'trip-4',
        amount: 25_000,
        approvedAt: '2026-09-02T00:00:00.000Z',
      },
    ]);
  });
});

describe('GET /api/admin/reconcile -- registration-linked (trip) payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  it('reports a stranded registration-linked payment in tripStrandedEscrow, not strandedEscrow', async () => {
    const tx = makeTx({
      ledgerRows: [],
      payments: [
        {
          id: 'payment-1',
          volunteerTripId: 'trip-1',
          amount: 100_000,
          providerFee: 0,
          escrowReleasedAt: new Date('2026-08-10'),
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripStrandedEscrow).toEqual([
      {
        paymentId: 'payment-1',
        volunteerTripId: 'trip-1',
        creditedNet: 100_000,
        releasedAmount: 0,
        refundedAmount: 0,
        residual: 100_000,
      },
    ]);
    expect(data.strandedEscrow).toEqual([]);
  });

  it('does not report a stranded registration-linked payment when residual is zero', async () => {
    const tx = makeTx({
      ledgerRows: [
        {
          transactionId: 'escrow-release:payment-1',
          direction: 'DEBIT',
          amount: 100_000,
          account: 'ESCROW_HOLD',
          campaignId: null,
          paymentId: 'payment-1',
        },
        {
          transactionId: 'escrow-release:payment-1',
          direction: 'CREDIT',
          amount: 100_000,
          account: 'TRIP_BALANCE',
          campaignId: null,
          volunteerTripId: 'trip-1',
        },
      ],
      payments: [
        {
          id: 'payment-1',
          volunteerTripId: 'trip-1',
          amount: 100_000,
          providerFee: 0,
          escrowReleasedAt: new Date('2026-08-10'),
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripStrandedEscrow).toEqual([]);
  });

  it('reports a long-deferred registration-linked payment in tripDeferredEscrowWatchdog', async () => {
    const longOverdue = new Date(Date.now() - (DEFERRED_ESCROW_WATCHDOG_DAYS + 1) * MS_PER_DAY);
    const tx = makeTx({
      payments: [
        {
          id: 'payment-1',
          volunteerTripId: 'trip-1',
          amount: 100_000,
          status: 'PAID',
          escrowReleaseAt: longOverdue,
          escrowReleasedAt: null,
        },
      ],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1', status: 'REQUESTED' }],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripDeferredEscrowWatchdog).toEqual([
      {
        paymentId: 'payment-1',
        volunteerTripId: 'trip-1',
        escrowReleaseAt: longOverdue.toISOString(),
        refunds: [{ refundId: 'refund-1', status: 'REQUESTED' }],
      },
    ]);
    expect(data.deferredEscrowWatchdog).toEqual([]);
    expect(data.tripDeferredEscrowWatchdog[0]).not.toHaveProperty('cause');
  });

  it('does not let a campaign-linked payment leak into either trip array', async () => {
    const tx = makeTx({
      ledgerRows: [],
      payments: [
        {
          id: 'payment-1',
          campaignId: 'campaign-1',
          amount: 100_000,
          providerFee: 0,
          escrowReleasedAt: new Date('2026-08-10'),
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.strandedEscrow).toEqual([
      {
        paymentId: 'payment-1',
        campaignId: 'campaign-1',
        creditedNet: 100_000,
        releasedAmount: 0,
        refundedAmount: 0,
        residual: 100_000,
      },
    ]);
    expect(data.tripStrandedEscrow).toEqual([]);
  });
});

describe('GET /api/admin/reconcile -- subjectless payments (data-integrity safety net)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  it('reports a released payment with neither donationId nor registrationId in subjectlessPayments, not either Trip/Campaign array, and does not crash', async () => {
    const tx = makeTx({
      ledgerRows: [],
      payments: [
        { id: 'payment-1', amount: 100_000, providerFee: 0, escrowReleasedAt: new Date('2026-08-10') },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.subjectlessPayments).toEqual([{ paymentId: 'payment-1', context: 'strandedEscrow' }]);
    expect(data.strandedEscrow).toEqual([]);
    expect(data.tripStrandedEscrow).toEqual([]);
  });

  it('reports a deferred-candidate payment with neither donationId nor registrationId in subjectlessPayments, not either Trip/Campaign watchdog array, and does not crash', async () => {
    const longOverdue = new Date(Date.now() - (DEFERRED_ESCROW_WATCHDOG_DAYS + 1) * MS_PER_DAY);
    const tx = makeTx({
      payments: [
        {
          id: 'payment-1',
          amount: 100_000,
          status: 'PAID',
          escrowReleaseAt: longOverdue,
          escrowReleasedAt: null,
        },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.subjectlessPayments).toEqual([{ paymentId: 'payment-1', context: 'deferredEscrowWatchdog' }]);
    expect(data.deferredEscrowWatchdog).toEqual([]);
    expect(data.tripDeferredEscrowWatchdog).toEqual([]);
  });

  it('reports an empty subjectlessPayments on a clean ledger', async () => {
    const tx = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.subjectlessPayments).toEqual([]);
  });
});

/**
 * The per-provider reconciliation (prd-compliance 35; PRD FFI-07; ADR 0011).
 *
 * This is the part of the report the ticket was filed for: the difference
 * between money sitting at the payment provider and money in the bank, visible
 * rather than assumed. The tests below are about the two ways a report like
 * this can quietly lie -- by folding an unattributable movement into a named
 * provider, and by reporting a provider nobody actually checked as reconciled.
 */
describe('GET /api/admin/reconcile -- the Provider Balance and the sweep to the bank (prd-compliance 35)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  /** A settlement at Sumopod, debiting the Provider Balance. */
  const settlement = (overrides: Partial<LedgerRow> = {}): LedgerRow => ({
    transactionId: 'webhook:sumopod:evt-1',
    direction: 'DEBIT',
    amount: 1_200_000,
    account: 'GATEWAY_CLEARING',
    campaignId: null,
    paymentId: 'payment-1',
    provider: 'sumopod',
    ...overrides,
  });

  const sweep = (overrides: Partial<ProviderWithdrawalRow> = {}): ProviderWithdrawalRow => ({
    id: 'pw-1',
    provider: 'sumopod',
    reference: 'SP-2026-09-30-001',
    amount: 750_000,
    destinationName: 'Yayasan Sehat Mandiri',
    collectingEntityId: 'org-1',
    providerBalanceBefore: 1_200_000,
    providerBalanceAfter: 450_000,
    proofReference: 'dokumen/sweep-001.pdf',
    recordedById: 'admin-1',
    recordedAt: new Date('2026-09-30T00:00:00.000Z'),
    ...overrides,
  });

  async function reportFor(options: Parameters<typeof makeTx>[0]) {
    const tx = makeTx(options);
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    return response.json();
  }

  it('reports the Provider Balance per provider, debit-normal', async () => {
    const data = await reportFor({ ledgerRows: [settlement()] });

    // Positive: money IS there. A pot of 1_200_000 printed as -1_200_000 reads
    // as an overdraft and would send whoever reads it hunting the wrong thing.
    expect(data.providerReconciliation.pots).toEqual([
      { provider: 'sumopod', debited: 1_200_000, credited: 0, balance: 1_200_000 },
    ]);
  });

  it('keeps the movements that name no provider as their own bucket rather than folding them into a named one', async () => {
    // A completed Payout credits GATEWAY_CLEARING with no provider
    // (payoutCompletedLegs, PR #73). Folding it into Sumopod would hand Sumopod
    // a pot smaller than the money that actually left it, and the gap would then
    // read as Sumopod's own discrepancy rather than as this known limitation.
    const data = await reportFor({
      ledgerRows: [
        settlement(),
        {
          transactionId: 'payout-completed-payout-1',
          direction: 'CREDIT',
          amount: 120_000,
          account: 'GATEWAY_CLEARING',
          campaignId: null,
          provider: null,
        },
      ],
    });

    expect(data.providerReconciliation.pots).toEqual([
      { provider: 'sumopod', debited: 1_200_000, credited: 0, balance: 1_200_000 },
      { provider: null, debited: 0, credited: 120_000, balance: -120_000 },
    ]);
    expect(data.providerReconciliation.unattributedBalance).toBe(-120_000);
    expect(data.providerReconciliation.perProviderIsExact).toBe(false);
  });

  it('says the per-provider split is exact only when every Provider Balance movement names a provider', async () => {
    const exact = await reportFor({ ledgerRows: [settlement()] });
    expect(exact.providerReconciliation.perProviderIsExact).toBe(true);

    const inexact = await reportFor({
      ledgerRows: [
        settlement(),
        { transactionId: 'x', direction: 'CREDIT', amount: 1, account: 'GATEWAY_CLEARING', campaignId: null, provider: null },
      ],
    });
    expect(inexact.providerReconciliation.perProviderIsExact).toBe(false);
  });

  it('reports the whole Provider Balance as well, which is the figure ADR 0011 states its invariant over', async () => {
    const data = await reportFor({
      ledgerRows: [
        settlement(),
        { transactionId: 'x', direction: 'CREDIT', amount: 120_000, account: 'GATEWAY_CLEARING', campaignId: null, provider: null },
      ],
    });

    // 1_200_000 at Sumopod less 120_000 that left unnamed. The invariant
    // "Provider Balance = GATEWAY_CLEARING less what an Admin has withdrawn" is
    // stated over the whole account, not over one provider's slice of it.
    expect(data.providerReconciliation.providerBalanceTotal).toBe(1_080_000);
  });

  it('reconciles a recorded sweep against the ledger and reports zero when the provider and the books agree', async () => {
    const data = await reportFor({
      ledgerRows: [
        settlement(),
        { transactionId: 'provider-withdrawal-pw-1', direction: 'CREDIT', amount: 750_000, account: 'GATEWAY_CLEARING', campaignId: null, provider: 'sumopod', providerWithdrawalId: 'pw-1' },
        { transactionId: 'provider-withdrawal-pw-1', direction: 'DEBIT', amount: 750_000, account: 'COLLECTION_ACCOUNT', campaignId: null, provider: 'sumopod', providerWithdrawalId: 'pw-1' },
      ],
      providerWithdrawals: [sweep()],
    });

    expect(data.providerReconciliation.withdrawals).toEqual([
      {
        provider: 'sumopod',
        pot: { provider: 'sumopod', debited: 1_200_000, credited: 750_000, balance: 450_000 },
        withdrawn: 750_000,
        providerMovedBy: 750_000,
        difference: 0,
        withdrawals: [
          {
            withdrawalId: 'pw-1',
            provider: 'sumopod',
            reference: 'SP-2026-09-30-001',
            amount: 750_000,
            destinationName: 'Yayasan Sehat Mandiri',
            collectingEntityId: 'org-1',
            providerBalanceBefore: 1_200_000,
            providerBalanceAfter: 450_000,
            providerMovedBy: 750_000,
            difference: 0,
            recordedAt: '2026-09-30T00:00:00.000Z',
          },
        ],
      },
    ]);
    // And the sweep is the only thing that moved the money into the bank, which
    // is the number the ticket exists to make visible.
    expect(data.providerReconciliation.collectionAccountBalance).toBe(750_000);
  });

  it('reports a systematic divergence, per sweep and in total, and corrects nothing', async () => {
    // The provider charged a fee on the transfer, so its own balance fell by
    // 20_000 more than we swept. The books said 750_000 left; the dashboard said
    // 770_000 did. That gap is the finding -- it is reported, and nothing in this
    // report writes a journal to make it go away, because a reconciliation that
    // fixes its own findings destroys the only evidence of what went wrong.
    const data = await reportFor({
      ledgerRows: [
        settlement(),
        { transactionId: 'provider-withdrawal-pw-1', direction: 'CREDIT', amount: 750_000, account: 'GATEWAY_CLEARING', campaignId: null, provider: 'sumopod', providerWithdrawalId: 'pw-1' },
        { transactionId: 'provider-withdrawal-pw-1', direction: 'DEBIT', amount: 750_000, account: 'COLLECTION_ACCOUNT', campaignId: null, provider: 'sumopod', providerWithdrawalId: 'pw-1' },
      ],
      providerWithdrawals: [sweep({ providerBalanceAfter: 430_000 })],
    });

    expect(data.providerReconciliation.divergence.totalDifference).toBe(20_000);
    expect(data.providerReconciliation.divergence.providersWithDivergence).toEqual(['sumopod']);
    expect(data.providerReconciliation.withdrawals[0].withdrawals[0].difference).toBe(20_000);
    // The ledger's own pot is untouched by the disagreement.
    expect(data.providerReconciliation.withdrawals[0].pot.balance).toBe(450_000);
  });

  it('reports no withdrawal at all rather than a clean reconciliation when nothing has been swept', async () => {
    // A pot nobody has read is not a pot that has been checked. An empty
    // `withdrawals` says "no sweep recorded"; a `difference: 0` would say
    // "checked and matched", and only one of those is true.
    const data = await reportFor({ ledgerRows: [settlement()] });

    expect(data.providerReconciliation.withdrawals).toEqual([]);
    expect(data.providerReconciliation.divergence.totalDifference).toBe(0);
    expect(data.providerReconciliation.divergence.providersWithDivergence).toEqual([]);
  });

  it('does not let a provider with a pot but no recorded sweep appear as reconciled', async () => {
    const data = await reportFor({ ledgerRows: [settlement()] });

    // It is in `pots`, because the money really is there and an Admin needs to
    // see it. It is not in `withdrawals`, because nobody has checked it.
    expect(data.providerReconciliation.pots.map((p: { provider: string | null }) => p.provider)).toEqual(['sumopod']);
    expect(data.providerReconciliation.withdrawals).toEqual([]);
  });

  it('reports what was collected under each Kind, which is the licence axis of the report', async () => {
    // Two Kinds under two different Fundraising Permits (prd-compliance 10), and
    // the point is that a per-Kind figure is derivable at all. The Kind is read
    // by joining Campaign -> Donation -> Payment, never from a stored copy on the
    // ledger entry: a denormalised second source of truth for something that
    // cannot change is still a second source of truth, and it is the drift this
    // repo already has a name for (Campaign.collectedAmount).
    const data = await reportFor({
      campaigns: [
        { id: 'campaign-1', title: 'Bantuan zakat', collectedAmount: 500_000, kind: 'ZAKAT' },
        { id: 'campaign-2', title: 'Bantuan anak', collectedAmount: 300_000, kind: 'DONATION' },
      ],
      payments: [
        { id: 'payment-1', campaignId: 'campaign-1', amount: 500_000 },
        { id: 'payment-2', campaignId: 'campaign-2', amount: 300_000 },
      ],
      ledgerRows: [
        settlement({ amount: 500_000, paymentId: 'payment-1' }),
        settlement({ transactionId: 'webhook:sumopod:evt-2', amount: 300_000, paymentId: 'payment-2' }),
      ],
    });

    // Keyed, so the order is the Kind's own and not whatever order a groupBy
    // happened to answer in.
    expect(data.providerReconciliation.collectedByKind).toEqual([
      { kind: 'DONATION', settledGross: 300_000 },
      { kind: 'ZAKAT', settledGross: 500_000 },
    ]);
  });

  it('excludes a Demo Campaign from the per-Kind figures, whose data is fixture data with no ledger behind it', async () => {
    const data = await reportFor({
      campaigns: [{ id: 'campaign-1', title: 'Contoh', collectedAmount: 900_000, isDemo: true, kind: 'DONATION' }],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1', amount: 900_000 }],
      ledgerRows: [settlement({ amount: 900_000, paymentId: 'payment-1' })],
    });

    expect(data.providerReconciliation.collectedByKind).toEqual([]);
  });

  it('says a Trip Fee settlement belongs to no Kind, rather than filing it under the nearest one', async () => {
    // A Volunteer Trip is not a Kind (ADR 0014) and holds no Fundraising Permit,
    // so its money cannot be counted under one. It is still in `pots`, because
    // it is still sitting at the provider.
    const data = await reportFor({
      campaigns: [{ id: 'campaign-1', title: 'Kampanye', collectedAmount: 100_000, kind: 'DONATION' }],
      payments: [
        { id: 'payment-1', campaignId: 'campaign-1', amount: 100_000 },
        { id: 'payment-trip', volunteerTripId: 'trip-1', amount: 250_000 },
      ],
      ledgerRows: [
        settlement({ amount: 100_000, paymentId: 'payment-1' }),
        settlement({ transactionId: 'webhook:sumopod:evt-trip', amount: 250_000, paymentId: 'payment-trip' }),
      ],
    });

    expect(data.providerReconciliation.collectedByKind).toEqual([{ kind: 'DONATION', settledGross: 100_000 }]);
    expect(data.providerReconciliation.pots[0].debited).toBe(350_000);
  });
});
