import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock prisma wholesale, matching src/app/api/webhooks/[provider]/route.test.ts.
// The fake tx below runs the real ledger (groupBy/count/createMany), so
// campaignBalance and postTransaction are exercised for real -- assertions
// below check the rows actually handed to ledgerEntry.createMany, not merely
// that some function was called.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    payout: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockPayoutFindUnique = prisma.payout.findUnique as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
};

function makePayoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    campaignId: 'campaign-1',
    amount: 100_000,
    description: 'Pencairan dana',
    status: 'DRAFT',
    requestedById: 'creator-1',
    approvedById: null,
    approvedAt: null,
    providerRef: null,
    bankAccount: {
      id: 'bank-1',
      bankCode: 'BCA',
      accountNumber: '1234567890',
      accountName: 'Creator One',
    },
    ...overrides,
  };
}

/**
 * A fake tx client backing the approve+release transaction: a mutable
 * `payout` row plus the real ledger's groupBy/count/createMany (same
 * simulation as src/lib/money/ledger.test.ts), so the transition, the
 * balance recheck and the posted legs are all exercised for real.
 */
function makeTx(options: {
  payout: ReturnType<typeof makePayoutRow> | null;
  ledgerRows?: LedgerRow[];
  updateManyCount?: number;
}) {
  const { payout, ledgerRows = [], updateManyCount = 1 } = options;
  const rows: LedgerRow[] = [...ledgerRows];
  let currentStatus = payout?.status;

  const findUnique = vi.fn().mockResolvedValue(payout);
  const updateMany = vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
    if (updateManyCount === 0 || currentStatus !== where.status) {
      return { count: 0 };
    }
    currentStatus = data.status as string;
    return { count: 1 };
  });
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...payout,
    ...data,
  }));

  return {
    tx: {
      payout: { findUnique, updateMany, update },
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
    ledgerRows: rows,
    updateMany,
    update,
  };
}

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/payouts/payout-1/approve', {
    method: 'POST',
  });
}

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-campaign', id: 'payout-1' }) };
}

const FULL_BALANCE_ROWS: LedgerRow[] = [
  { transactionId: 't1', direction: 'CREDIT', amount: 100_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
];

describe('POST /api/campaigns/[slug]/payouts/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'campaign-1' });
    mockGetPaymentProvider.mockReturnValue({
      createPayout: vi.fn().mockResolvedValue({ payoutId: 'provider-payout-1', status: 'completed' }),
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for MODERATOR, which sits below ADMIN', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR' } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the payout does not belong to this campaign', async () => {
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'a-different-campaign' });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 503 and touches nothing when the payment provider is not configured', async () => {
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError('MOCK_MIDTRANS_SERVER_KEY');
    });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(503);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('refuses self-approval with 403 and leaves the payout completely untouched', async () => {
    // The requester and the approver are the same person.
    mockGetServerSession.mockResolvedValue({ user: { id: 'creator-1', role: 'ADMIN' } });
    const { tx, updateMany, update } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/mengajukan|approv/i);
    // Not REJECTED, not annotated -- no write of any kind.
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it('refuses to approve a payout that is not DRAFT (e.g. already COMPLETED) with 409', async () => {
    const { tx, updateMany } = makeTx({ payout: makePayoutRow({ status: 'COMPLETED' }), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it('rejects approval when the balance no longer covers it, re-checked at approval time', async () => {
    // The payout asks for 100_000 but the ledger only shows 40_000 left --
    // simulating a refund or another payout eating the balance since the
    // request was made.
    const { tx, updateMany } = makeTx({
      payout: makePayoutRow({ amount: 100_000 }),
      ledgerRows: [
        { transactionId: 't1', direction: 'CREDIT', amount: 40_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/saldo/i);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('approves and releases: PROCESSING, balanced entries, and the balance drops by exactly the payout', async () => {
    const { tx, ledgerRows } = makeTx({ payout: makePayoutRow({ amount: 100_000 }), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('PROCESSING');
    expect(data.providerRef).toBe('provider-payout-1');

    // The legs themselves: debit withdrawable, credit clearing, exactly the
    // payout amount, and debits equal credits.
    expect(ledgerRows.filter((r) => r.transactionId !== 't1')).toEqual([
      expect.objectContaining({ account: 'CAMPAIGN_BALANCE', direction: 'DEBIT', amount: 100_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount: 100_000, campaignId: null }),
    ]);
    const posted = ledgerRows.filter((r) => r.transactionId !== 't1');
    const debits = posted.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    const credits = posted.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(credits);

    // Balance drops by exactly the payout: was 100_000, now 0.
    expect(await import('@/lib/money/ledger').then((m) => m.campaignBalance(tx as never, 'campaign-1'))).toBe(0);
  });

  it('a second approval that loses the race changes nothing: no provider call, no ledger post, no final update', async () => {
    const providerCreatePayout = vi.fn();
    mockGetPaymentProvider.mockReturnValue({ createPayout: providerCreatePayout });
    // updateManyCount: 0 simulates another approval having already flipped
    // this payout's status out of DRAFT between this call's read and its
    // write -- exactly what a real database's WHERE-matched updateMany
    // returns for the loser.
    const { tx, update } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS, updateManyCount: 0 });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(providerCreatePayout).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('a payout is not satisfiable twice against one balance: approving a second DRAFT payout after the first already spent it fails', async () => {
    // Two separate DRAFT payouts each ask for the full 100_000 balance.
    // Nothing is posted at request time (see the sibling payouts/route.test.ts),
    // so both could be created; the ledger recheck inside approval is what
    // actually stops the second one from being paid out too.
    const first = makeTx({ payout: makePayoutRow({ id: 'payout-1', amount: 100_000 }), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementationOnce((cb: (tx: unknown) => unknown) => cb(first.tx));
    const firstResponse = await POST(createRequest(), routeContext());
    expect(firstResponse.status).toBe(200);

    // Second payout, same campaign, sharing the ledger state the first
    // approval left behind (the CAMPAIGN_BALANCE credit plus the instructed
    // debit already posted).
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'campaign-1' });
    const second = makeTx({
      payout: makePayoutRow({ id: 'payout-2', amount: 100_000 }),
      ledgerRows: [...first.ledgerRows],
    });
    mockTransaction.mockImplementationOnce((cb: (tx: unknown) => unknown) => cb(second.tx));

    const secondResponse = await POST(
      createRequest(),
      { params: Promise.resolve({ slug: 'test-campaign', id: 'payout-2' }) },
    );
    const secondData = await secondResponse.json();

    expect(secondResponse.status).toBe(400);
    expect(secondData.error).toMatch(/saldo/i);
    expect(second.update).not.toHaveBeenCalled();
  });
});
