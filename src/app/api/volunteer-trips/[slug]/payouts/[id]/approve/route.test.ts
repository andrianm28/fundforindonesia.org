import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    payout: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockPayoutFindUnique = prisma.payout.findUnique as unknown as Mock;
const mockPayoutUpdateManyTop = prisma.payout.updateMany as unknown as Mock;
const mockPayoutFindUniqueOrThrow = prisma.payout.findUniqueOrThrow as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

/** What the subject guard reads under the Trip row lock (src/lib/subject-guard.ts). */
const ACTIVE_TRIP = { fundraiserId: 'fundraiser-1', status: 'ACTIVE' };

function makePayoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    campaignId: null,
    volunteerTripId: 'trip-1',
    amount: 200_000,
    description: 'Pencairan trip',
    status: 'DRAFT',
    requestedById: 'fundraiser-1',
    approvedById: null,
    approvedAt: null,
    providerRef: null,
    bankAccount: {
      id: 'bank-1',
      ownerId: 'fundraiser-1',
      bankCode: 'BCA',
      accountNumber: '1234567890',
      accountName: 'Fundraiser One',
      verifiedAt: new Date('2026-01-01'),
    },
    ...overrides,
  };
}

function makeTx(options: { payout: ReturnType<typeof makePayoutRow> | null; ledgerRows?: LedgerRow[]; updateManyCount?: number }) {
  const { payout, ledgerRows = [], updateManyCount = 1 } = options;
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
  const queryRawCalls: string[] = [];
  const queryRaw = vi.fn((strings: TemplateStringsArray) => {
    queryRawCalls.push(strings.join(''));
    return Promise.resolve([{ id: payout?.volunteerTripId ?? 'trip-1' }]);
  });

  return {
    tx: {
      payout: { findUnique, updateMany },
      $queryRaw: queryRaw,
      // The Trip row the subject guard reads under that lock.
      volunteerTrip: { findUnique: vi.fn().mockResolvedValue(ACTIVE_TRIP) },
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
    queryRawCalls,
  };
}

/** A strict FIFO async mutex, used only by the genuine-concurrency test below -- copied from src/app/api/campaigns/[slug]/payouts/[id]/approve/route.test.ts's own helper of the same name. */
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
  return new NextRequest('http://localhost:3000/api/volunteer-trips/test-trip/payouts/payout-1/approve', { method: 'POST' });
}

function routeContext(id = 'payout-1') {
  return { params: Promise.resolve({ slug: 'test-trip', id }) };
}

const FULL_BALANCE_ROWS: LedgerRow[] = [
  { transactionId: 't1', direction: 'CREDIT', amount: 200_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
];

describe('POST /api/volunteer-trips/[slug]/payouts/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1' });
    mockPayoutFindUnique.mockResolvedValue({ volunteerTripId: 'trip-1' });
    mockPayoutUpdateManyTop.mockResolvedValue({ count: 1 });
    mockPayoutFindUniqueOrThrow.mockResolvedValue(makePayoutRow({ status: 'APPROVED', approvedById: 'admin-1' }));
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the payout does not belong to this trip', async () => {
    mockPayoutFindUnique.mockResolvedValue({ volunteerTripId: 'a-different-trip' });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('REGRESSION: returns 404 when the payout is actually Campaign-linked (volunteerTripId null) -- a Campaign Payout can never be approved through the Trip route', async () => {
    mockPayoutFindUnique.mockResolvedValue({ volunteerTripId: null });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('answers 404 PAYOUT_NOT_FOUND when the Payout is gone by the time approval reads it', async () => {
    const { tx } = makeTx({ payout: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('PAYOUT_NOT_FOUND');
  });

  it('refuses self-approval with 403 and leaves the payout completely untouched', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1', role: 'ADMIN', assignments: ['ADMIN'] } });
    const { tx, updateMany, queryRaw } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('SELF_APPROVAL');
    expect(queryRaw).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('refuses to approve a payout that is not DRAFT with 409', async () => {
    const { tx, updateMany, queryRaw } = makeTx({ payout: makePayoutRow({ status: 'COMPLETED' }), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('INVALID_PAYOUT_STATUS');
    expect(queryRaw).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses approval when the bank account is no longer eligible with 403', async () => {
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
  });

  it('rejects approval when TRIP_BALANCE no longer covers it, re-checked at approval time', async () => {
    const { tx, updateMany, queryRaw } = makeTx({
      payout: makePayoutRow({ amount: 200_000 }),
      ledgerRows: [{ transactionId: 't1', direction: 'CREDIT', amount: 40_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' }],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INSUFFICIENT_BALANCE');
    expect(queryRaw).toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('approves: locks "VolunteerTrip" (never "Campaign"), posts TRIP_BALANCE debit / PAYOUT_CLEARING credit, balance drops to zero', async () => {
    const { tx, ledgerRows, queryRaw, queryRawCalls } = makeTx({ payout: makePayoutRow({ amount: 200_000 }), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('APPROVED');
    expect(queryRaw).toHaveBeenCalled();
    expect(queryRawCalls.some((q) => q.includes('VolunteerTrip'))).toBe(true);
    expect(queryRawCalls.some((q) => q.includes('"Campaign"'))).toBe(false);

    const posted = ledgerRows.filter((r) => r.transactionId !== 't1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'TRIP_BALANCE', direction: 'DEBIT', amount: 200_000, volunteerTripId: 'trip-1', campaignId: null }),
      expect.objectContaining({ account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount: 200_000 }),
    ]);
    expect(posted[0].transactionId).toBe('payout-instructed-payout-1');

    const finalBalance = await import('@/lib/money/ledger').then((m) => m.tripBalance(tx as never, 'trip-1'));
    expect(finalBalance).toBe(0);
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('a second approval that loses the race changes nothing', async () => {
    const { tx } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS, updateManyCount: 0 });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('INVALID_PAYOUT_STATUS');
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('does not let two different DRAFT payouts on one Trip both spend the same TRIP_BALANCE when approved concurrently', async () => {
    const payoutRows = new Map<string, ReturnType<typeof makePayoutRow>>([
      ['payout-a', makePayoutRow({ id: 'payout-a', amount: 200_000 })],
      ['payout-b', makePayoutRow({ id: 'payout-b', amount: 200_000 })],
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
        return [{ id: 'trip-1' }];
      }),
      volunteerTrip: { findUnique: vi.fn().mockResolvedValue(ACTIVE_TRIP) },
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
      return row ? { volunteerTripId: row.volunteerTripId } : null;
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

    expect(statuses).toEqual([200, 400]);

    const finalBalance = await import('@/lib/money/ledger').then((m) => m.tripBalance(sharedTx as never, 'trip-1'));
    expect(finalBalance).toBe(0);
  });
});
