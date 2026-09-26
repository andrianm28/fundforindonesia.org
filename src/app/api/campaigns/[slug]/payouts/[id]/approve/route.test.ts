import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock prisma wholesale, matching src/app/api/webhooks/[provider]/route.test.ts.
// The fake tx below runs the real ledger (groupBy/count/createMany), so
// campaignBalance and postTransaction are exercised for real -- assertions
// below check the rows actually handed to ledgerEntry.createMany, not merely
// that some function was called.
//
// payout.updateMany/findUniqueOrThrow at the TOP level (not tx) exist because
// approvePayout runs two separate transactions around the provider
// call: phase 1 is `prisma.$transaction(...)` (the `tx` fake below), phase 2
// is a second, plain `prisma.payout.updateMany` + `findUniqueOrThrow`.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    payout: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
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
const mockPayoutUpdateManyTop = prisma.payout.updateMany as unknown as Mock;
const mockPayoutFindUniqueOrThrow = prisma.payout.findUniqueOrThrow as unknown as Mock;
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

/** What the subject guard reads under the Campaign row lock (src/lib/subject-guard.ts). */
const ACTIVE_CAMPAIGN = { creatorId: 'creator-1', isDemo: false, lifecycleStatus: 'ACTIVE', deadline: null };

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
      ownerId: 'creator-1',
      bankCode: 'BCA',
      accountNumber: '1234567890',
      accountName: 'Creator One',
      verifiedAt: new Date('2026-01-01'),
    },
    ...overrides,
  };
}

/**
 * A fake tx client backing PHASE 1 (the transaction inside
 * approvePayout): a mutable `state` row, a `$queryRaw` stand-in for
 * the campaign row lock, and the real ledger's groupBy/count/createMany (same
 * simulation as src/lib/money/ledger.test.ts), so the transition, the
 * destination re-check, the balance recheck and the posted legs are all
 * exercised for real.
 */
function makeTx(options: {
  payout: ReturnType<typeof makePayoutRow> | null;
  ledgerRows?: LedgerRow[];
  updateManyCount?: number;
  /** The Campaign's stored status, read by the subject guard under its lock. */
  lifecycleStatus?: string;
}) {
  const { payout, ledgerRows = [], updateManyCount = 1, lifecycleStatus = 'ACTIVE' } = options;
  const rows: LedgerRow[] = [...ledgerRows];
  const state = payout ? { ...payout } : null;

  const findUnique = vi.fn().mockResolvedValue(state);
  const updateMany = vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
    if (!state || updateManyCount === 0 || state.status !== where.status) {
      return { count: 0 };
    }
    Object.assign(state, data);
    return { count: 1 };
  });
  const queryRaw = vi.fn().mockResolvedValue([{ id: payout?.campaignId ?? 'campaign-1' }]);

  return {
    tx: {
      payout: { findUnique, updateMany },
      $queryRaw: queryRaw,
      // The Campaign row the subject guard reads under that lock.
      campaign: { findUnique: vi.fn().mockResolvedValue({ ...ACTIVE_CAMPAIGN, lifecycleStatus }) },
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
    state,
    ledgerRows: rows,
    updateMany,
    queryRaw,
  };
}

/** A strict FIFO async mutex, used only by the genuine-concurrency test below. */
function makeMutex() {
  let tail: Promise<void> = Promise.resolve();
  return {
    enter(): Promise<() => void> {
      let release!: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      const acquired = tail.then(() => release);
      tail = next;
      return acquired;
    },
  };
}

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/payouts/payout-1/approve', {
    method: 'POST',
  });
}

function routeContext(id = 'payout-1') {
  return { params: Promise.resolve({ slug: 'test-campaign', id }) };
}

const FULL_BALANCE_ROWS: LedgerRow[] = [
  { transactionId: 't1', direction: 'CREDIT', amount: 100_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
];

describe('POST /api/campaigns/[slug]/payouts/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'campaign-1' });
    mockGetPaymentProvider.mockReturnValue({
      createPayout: vi.fn().mockResolvedValue({ payoutId: 'provider-payout-1', status: 'completed' }),
    });
    // Approval's final shape: APPROVED, with no providerRef, because no
    // provider is ever instructed here. Individual tests override when they
    // need to inspect the response body.
    mockPayoutUpdateManyTop.mockResolvedValue({ count: 1 });
    mockPayoutFindUniqueOrThrow.mockResolvedValue(
      makePayoutRow({ status: 'APPROVED', approvedById: 'admin-1' }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', assignments: ['VERIFIER'] } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-1', assignments: [] } });
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

  it.each(['SUSPENDED', 'CANCELLED'])(
    'answers 409 PAYOUT_NOT_ALLOWED_FOR_STATUS when the Campaign is %s by approval time, leaving the Payout DRAFT and posting nothing',
    async (lifecycleStatus) => {
      const { tx, state, ledgerRows } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS, lifecycleStatus });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const response = await POST(createRequest(), routeContext());
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('PAYOUT_NOT_ALLOWED_FOR_STATUS');
      expect(state).toMatchObject({ status: 'DRAFT', approvedById: null });
      expect(ledgerRows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
    },
  );

  it('returns 404 when the payout does not belong to this campaign', async () => {
    mockPayoutFindUnique.mockResolvedValue({ campaignId: 'a-different-campaign' });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the payout is actually Trip-linked (campaignId null) -- a Trip payout can never be approved through the Campaign route', async () => {
    mockPayoutFindUnique.mockResolvedValue({ campaignId: null });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('approves without resolving a payment provider at all', async () => {
    // Regression test. Approval used to call provider.createPayout after
    // committing the instructed legs. With Sumopod -- the only provider
    // before launch, and one with no disbursement API -- that threw
    // SumopodNotSupportedError on every approval in production, stranding
    // the payout APPROVED with no way forward. No test caught it because
    // none approved with the real adapter. Approval must not touch a
    // provider: the second admin withdraws by hand (ADR 0006, FFI-07).
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError('MOCK_MIDTRANS_SERVER_KEY');
    });
    const { tx } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockGetPaymentProvider).not.toHaveBeenCalled();
  });

  it('answers 404 PAYOUT_NOT_FOUND when the Payout is gone by the time approval reads it', async () => {
    const { tx } = makeTx({ payout: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('PAYOUT_NOT_FOUND');
  });

  it('refuses self-approval with 403 and leaves the payout completely untouched', async () => {
    // The requester and the approver are the same person.
    mockGetServerSession.mockResolvedValue({ user: { id: 'creator-1', assignments: ['ADMIN'] } });
    const { tx, updateMany, queryRaw } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('SELF_APPROVAL');
    // Not REJECTED, not annotated -- no write of any kind, not even the
    // campaign row lock.
    expect(queryRaw).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('refuses to approve a payout that is not DRAFT (e.g. already COMPLETED) with 409', async () => {
    const { tx, updateMany, queryRaw } = makeTx({ payout: makePayoutRow({ status: 'COMPLETED' }), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('INVALID_PAYOUT_STATUS');
    expect(queryRaw).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it('refuses approval when the bank account is no longer eligible (verifiedAt cleared since the request) with 403', async () => {
    // Simulates an operator revoking verification on an account discovered
    // to be fraudulent in the window between request and approval -- the
    // scenario ownership/verification is re-checked at approval to catch.
    const { tx, updateMany } = makeTx({
      payout: makePayoutRow({ bankAccount: { ...makePayoutRow().bankAccount, verifiedAt: null } }),
      ledgerRows: FULL_BALANCE_ROWS,
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('BANK_ACCOUNT_NOT_ELIGIBLE');
    expect(updateMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('refuses approval when the bank account has changed owner since the request', async () => {
    const { tx, updateMany } = makeTx({
      payout: makePayoutRow({ bankAccount: { ...makePayoutRow().bankAccount, ownerId: 'a-stranger' } }),
      ledgerRows: FULL_BALANCE_ROWS,
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('BANK_ACCOUNT_NOT_ELIGIBLE');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects approval when the balance no longer covers it, re-checked at approval time', async () => {
    // The payout asks for 100_000 but the ledger only shows 40_000 left --
    // simulating a refund or another payout eating the balance since the
    // request was made.
    const { tx, updateMany, queryRaw } = makeTx({
      payout: makePayoutRow({ amount: 100_000 }),
      ledgerRows: [
        { transactionId: 't1', direction: 'CREDIT', amount: 40_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INSUFFICIENT_BALANCE');
    // The lock IS taken here -- the balance check happens after it -- but
    // the transition never does.
    expect(queryRaw).toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('approves: APPROVED, balanced entries, and the balance drops by exactly the payout', async () => {
    const { tx, ledgerRows, queryRaw } = makeTx({ payout: makePayoutRow({ amount: 100_000 }), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('APPROVED');

    // The campaign row lock is taken before the balance is trusted.
    expect(queryRaw).toHaveBeenCalled();

    // The legs themselves: debit withdrawable, credit clearing, exactly the
    // payout amount, and debits equal credits.
    const posted = ledgerRows.filter((r) => r.transactionId !== 't1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'CAMPAIGN_BALANCE', direction: 'DEBIT', amount: 100_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount: 100_000, campaignId: null }),
    ]);
    expect(posted[0].transactionId).toBe('payout-instructed-payout-1');
    const debits = posted.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    const credits = posted.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(credits);

    // Balance drops by exactly the payout: was 100_000, now 0.
    expect(await import('@/lib/money/ledger').then((m) => m.campaignBalance(tx as never, 'campaign-1'))).toBe(0);

    // Nothing moves the payout past APPROVED. Draining PAYOUT_CLEARING is
    // the completion step's job, and that endpoint does not exist yet.
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('a second approval that loses the race changes nothing: no provider call, no ledger post, no final update', async () => {
    const providerCreatePayout = vi.fn();
    mockGetPaymentProvider.mockReturnValue({ createPayout: providerCreatePayout });
    // updateManyCount: 0 simulates another approval having already flipped
    // this payout's status out of DRAFT between this call's read and its
    // write -- exactly what a real database's WHERE-matched updateMany
    // returns for the loser.
    const { tx } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS, updateManyCount: 0 });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('INVALID_PAYOUT_STATUS');
    expect(providerCreatePayout).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('does not let two different DRAFT payouts on one campaign both spend the same balance when approved concurrently', async () => {
    // The Critical fix under test: campaignBalance() is a plain aggregate
    // with no row of its own to lock, so two admins approving two DIFFERENT
    // payouts against the same campaign at once must be serialised on the
    // Campaign row, not on either Payout row (that guard already existed and
    // is covered by the "loses the race" test above, which is about ONE
    // payout, not this). This test drives two POSTs genuinely concurrently
    // via Promise.all against one shared in-memory database, and a FIFO
    // mutex standing in for a real `SELECT ... FOR UPDATE` on the Campaign
    // row -- if the application code did not take that lock before reading
    // the balance, both approvals would read the pre-spend 100_000 and both
    // would succeed, driving the balance negative.
    const payoutRows = new Map<string, ReturnType<typeof makePayoutRow>>([
      ['payout-a', makePayoutRow({ id: 'payout-a', amount: 100_000 })],
      ['payout-b', makePayoutRow({ id: 'payout-b', amount: 100_000 })],
    ]);
    const ledgerRows: LedgerRow[] = [...FULL_BALANCE_ROWS];
    const mutex = makeMutex();
    const lockBox: { release?: () => void } = {};

    const sharedTx = {
      payout: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const row = payoutRows.get(where.id);
          return row ? { ...row } : null;
        }),
        updateMany: vi.fn(
          async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
            const row = payoutRows.get(where.id);
            if (!row || row.status !== where.status) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          },
        ),
      },
      $queryRaw: vi.fn(async () => {
        lockBox.release = await mutex.enter();
        return [{ id: 'campaign-1' }];
      }),
      campaign: { findUnique: vi.fn().mockResolvedValue(ACTIVE_CAMPAIGN) },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          ledgerRows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
          const filtered = ledgerRows.filter((r) => {
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
    };

    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      try {
        return await cb(sharedTx);
      } finally {
        lockBox.release?.();
        lockBox.release = undefined;
      }
    });
    mockPayoutFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const row = payoutRows.get(where.id);
      return row ? { campaignId: row.campaignId } : null;
    });
    mockPayoutUpdateManyTop.mockImplementation(
      async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const row = payoutRows.get(where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    );
    mockPayoutFindUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...payoutRows.get(where.id),
    }));

    const [responseA, responseB] = await Promise.all([
      POST(createRequest(), routeContext('payout-a')),
      POST(createRequest(), routeContext('payout-b')),
    ]);
    const statuses = [responseA.status, responseB.status].sort();

    // Exactly one succeeds and one is refused for insufficient balance --
    // never both, never neither.
    expect(statuses).toEqual([200, 400]);

    // The decisive assertion: the balance never goes negative. Without the
    // campaign lock, both would read the pre-spend 100_000, both would post
    // a 100_000 debit, and this would be -100_000.
    const finalBalance = await import('@/lib/money/ledger').then((m) =>
      m.campaignBalance(sharedTx as never, 'campaign-1'),
    );
    expect(finalBalance).toBe(0);
  });
});
