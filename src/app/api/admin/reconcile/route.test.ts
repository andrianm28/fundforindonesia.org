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
  paymentId?: string | null;
  refundId?: string | null;
};

type PayoutRow = {
  id: string;
  campaignId: string;
  amount: number;
  status: string;
  providerRef: string | null;
  approvedAt: Date | null;
};

type PaymentRow = {
  id: string;
  campaignId: string;
  amount?: number;
  providerFee?: number;
  status?: string;
  escrowReleaseAt?: Date | null;
  escrowReleasedAt?: Date | null;
};

type RefundRow = { id: string; paymentId: string; status?: string };

type CampaignRow = { id: string; title: string; collectedAmount: number; isDemo?: boolean };

/** Handles the `{ not }` and `{ in }` Prisma filter shapes this route's queries use. */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object') {
      if ('not' in (v as Record<string, unknown>)) return row[k] !== (v as { not: unknown }).not;
      if ('in' in (v as Record<string, unknown>)) return (v as { in: unknown[] }).in.includes(row[k]);
      if ('lte' in (v as Record<string, unknown>)) {
        const rowValue = row[k];
        return rowValue != null && (rowValue as Date) <= (v as { lte: Date }).lte;
      }
    }
    return row[k] === v;
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
        const normalized = payments.map((p) => ({ ...p, escrowReleasedAt: p.escrowReleasedAt ?? null }));
        return normalized
          .filter((p) => matchesWhere(p as never as Record<string, unknown>, where))
          .map((p) => ({
            id: p.id,
            amount: p.amount ?? 0,
            providerFee: p.providerFee ?? 0,
            escrowReleaseAt: p.escrowReleaseAt ?? null,
            donation: { campaignId: p.campaignId },
            // Nested relation select, backing the deferredEscrowWatchdog
            // query -- reads off the same `refunds` fixture array
            // refund.findMany below reads, joined by paymentId.
            refunds: refunds
              .filter((r) => r.paymentId === p.id)
              .map((r) => ({ id: r.id, status: r.status ?? 'REQUESTED' })),
          }));
      }),
    },
    refund: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        refunds
          .filter((r) => matchesWhere(r as never as Record<string, unknown>, where))
          .map((r) => ({ id: r.id, paymentId: r.paymentId })),
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
        amount: 75_000,
        approvedAt: '2026-08-05T00:00:00.000Z',
      },
    ]);
    expect(data.stuckPayouts.processing).toEqual([]);
  });
});
