import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    payment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockPaymentFindMany = prisma.payment.findMany as unknown as Mock;
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

function makeTx(options: { ledgerRows?: LedgerRow[]; bankAccount?: Record<string, unknown> | null } = {}) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const bankAccountFindUnique = vi.fn().mockResolvedValue(options.bankAccount ?? null);
  const payoutCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'payout-1',
    createdAt: new Date(),
    ...data,
  }));
  return {
    tx: {
      bankAccount: { findUnique: bankAccountFindUnique },
      payout: { create: payoutCreate },
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      refund: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      // The Trip row the subject guard reads under that lock.
      volunteerTrip: { findUnique: vi.fn().mockResolvedValue({ fundraiserId: 'fundraiser-1', status: 'ACTIVE' }) },
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
    bankAccountFindUnique,
    payoutCreate,
    rows,
  };
}

function verifiedBankAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bank-1',
    ownerId: 'fundraiser-1',
    bankCode: 'BCA',
    accountNumber: '1234567890',
    accountName: 'Fundraiser One',
    verifiedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/test-trip/payouts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/test-trip/payouts', { method: 'GET' });
}

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-trip' }) };
}

const VALID_BODY = { bankAccountId: 'bank-1', amount: 200_000, description: 'Pencairan trip' };

describe('POST /api/volunteer-trips/[slug]/payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1', role: 'DONOR', assignments: [] } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'fundraiser-1' });
    mockPaymentFindMany.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 403 NOT_AUTHORIZED when the caller is not this Trip's Fundraiser, whatever their Role", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body without ever resolving the trip', async () => {
    const response = await POST(postRequest({ bankAccountId: '', amount: -5, description: '' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockTripFindUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
  });

  it('rejects an unverified bank account with 403 and creates nothing', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount({ verifiedAt: null }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('BANK_ACCOUNT_NOT_ELIGIBLE');
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('rejects an amount over the withdrawable TRIP_BALANCE with 400, checked against the ledger', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows: [] });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest({ ...VALID_BODY, amount: 1 }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INSUFFICIENT_BALANCE');
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('REGRESSION: a Trip payout cannot be requested for more than the current TRIP_BALANCE, even when another Trip has ample TRIP_BALANCE rows', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 5_000_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'a-different-trip' },
    ];
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest({ ...VALID_BODY, amount: 1 }), routeContext());

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INSUFFICIENT_BALANCE');
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('lets the owner, with no Role or assignment, create a DRAFT payout with volunteerTripId set (never campaignId) when the balance covers it', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 200_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.status).toBe('DRAFT');
    expect(payoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ volunteerTripId: 'trip-1', campaignId: null, bankAccountId: 'bank-1', amount: 200_000, status: 'DRAFT' }),
      }),
    );
  });

  it('releases a matured escrow hold for this Trip before checking the withdrawable balance', async () => {
    mockPaymentFindMany.mockResolvedValue([
      {
        id: 'payment-1',
        amount: 200_000,
        providerFee: 0,
        donationId: null,
        registrationId: 'registration-1',
        donation: null,
        registration: { batch: { tripId: 'trip-1' } },
      },
    ]);
    const { tx, payoutCreate, rows } = makeTx({
      bankAccount: verifiedBankAccount(),
      ledgerRows: [
        { transactionId: 'settle-1', direction: 'CREDIT', amount: 200_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
      ],
    });
    tx.payment.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(201);
    expect(payoutCreate).toHaveBeenCalled();
    const releaseLegs = rows.filter((r) => r.transactionId === 'escrow-release:payment-1');
    expect(releaseLegs).toHaveLength(2);
  });
});

describe('GET /api/volunteer-trips/[slug]/payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1', role: 'DONOR', assignments: [] } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'fundraiser-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(401);
  });

  it("returns 403 when the caller is not this Trip's Fundraiser", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns escrowHold and tripBalance computed from the real ledger, never leaking a Campaign row', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 300_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
      { transactionId: 't2', direction: 'CREDIT', amount: 150_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
      { transactionId: 't3', direction: 'CREDIT', amount: 9_999_999, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx } = makeTx({ ledgerRows });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(getRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ escrowHold: 300_000, tripBalance: 150_000 });
  });
});
