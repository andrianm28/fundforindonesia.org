import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

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
};

type PayoutRow = {
  id: string;
  campaignId: string;
  amount: number;
  status: string;
  providerRef: string | null;
  approvedAt: Date | null;
};

type PaymentRow = { id: string; campaignId: string };

type CampaignRow = { id: string; title: string; collectedAmount: number };

/**
 * Minimal in-memory stand-in for the transaction client the route wraps its
 * whole report in. groupBy is the same simulation used throughout the money
 * layer's tests (src/lib/money/ledger.test.ts and friends).
 */
function makeTx(options: {
  ledgerRows?: LedgerRow[];
  payouts?: PayoutRow[];
  payments?: PaymentRow[];
  campaigns?: CampaignRow[];
} = {}) {
  const rows = options.ledgerRows ?? [];
  const payouts = options.payouts ?? [];
  const payments = options.payments ?? [];
  const campaigns = options.campaigns ?? [];

  return {
    ledgerEntry: {
      groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
        const filtered = rows.filter((r) => {
          const w = args.where ?? {};
          return Object.entries(w).every(([k, v]) => {
            if (v && typeof v === 'object' && 'not' in (v as Record<string, unknown>)) {
              return (r as never as Record<string, unknown>)[k] !== (v as { not: unknown }).not;
            }
            return (r as never as Record<string, unknown>)[k] === v;
          });
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
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) =>
          Object.entries(where).every(([k, v]) => {
            if (v && typeof v === 'object' && 'not' in (v as Record<string, unknown>)) {
              return (r as never as Record<string, unknown>)[k] !== (v as { not: unknown }).not;
            }
            return (r as never as Record<string, unknown>)[k] === v;
          }),
        ),
      ),
    },
    payment: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        payments
          .filter((p) => where.id.in.includes(p.id))
          .map((p) => ({ id: p.id, donation: { campaignId: p.campaignId } })),
      ),
    },
    campaign: {
      findMany: vi.fn(async () => campaigns),
    },
    payout: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        payouts
          .filter((p) => Object.entries(where).every(([k, v]) => (p as never as Record<string, unknown>)[k] === v))
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
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a MODERATOR, which sits below ADMIN', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR' } });
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
