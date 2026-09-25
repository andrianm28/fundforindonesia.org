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

type CampaignRow = { id: string; title: string; collectedAmount: number; isDemo?: boolean };

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
} = {}) {
  const rows = options.ledgerRows ?? [];
  const payouts = options.payouts ?? [];
  const payments = options.payments ?? [];
  const refunds = options.refunds ?? [];
  const campaigns = options.campaigns ?? [];

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
      findMany: vi.fn(async () => campaigns),
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
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment', async () => {
    // The exact scenario ADR 0005 exists to fix: rank alone must never
    // substitute for the assignment this route requires.
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-1', role: 'ADMIN', assignments: [] } });
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

describe('GET /api/admin/reconcile -- trip-scoped checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
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
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
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
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
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
