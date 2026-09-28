import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mirrors src/app/api/campaigns/[slug]/payouts/[id]/complete/route.test.ts,
// which is the fuller version of this file. A Trip Payout is the same
// movement with a different subject (ADR 0014), so what matters here is
// that the Trip path really does lock the Trip and never the Campaign, and
// that the two-person rule holds across both.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    payout: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
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

function makeApprovedTripPayout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    campaignId: null,
    volunteerTripId: 'trip-1',
    amount: 250_000,
    description: 'Pencairan Trip',
    status: 'APPROVED',
    requestedById: 'fundraiser-1',
    approvedById: 'admin-1',
    approvedAt: new Date('2026-02-01'),
    completedById: null,
    completedAt: null,
    proofImage: null,
    providerRef: null,
    // The destination, re-read at completion the way the approve route's row
    // carries it: completePayout refuses a completion whose Bank Account is
    // gone, no longer the fundraiser's, or no longer verified.
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

const INSTRUCTED_ROWS: LedgerRow[] = [
  { transactionId: 'payout-instructed-payout-1', direction: 'DEBIT', amount: 250_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
  { transactionId: 'payout-instructed-payout-1', direction: 'CREDIT', amount: 250_000, account: 'PAYOUT_CLEARING', campaignId: null, volunteerTripId: null },
];

function makeTx(options: { payout: ReturnType<typeof makeApprovedTripPayout> | null; tripStatus?: string }) {
  const { payout, tripStatus = 'OPEN' } = options;
  const rows: LedgerRow[] = [...INSTRUCTED_ROWS];
  const state = payout ? { ...payout } : null;

  const updateMany = vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
    if (!state || state.status !== where.status) return { count: 0 };
    Object.assign(state, data);
    return { count: 1 };
  });
  const queryRaw = vi.fn().mockResolvedValue([{ id: 'trip-1' }]);

  return {
    tx: {
      payout: { findUnique: vi.fn().mockResolvedValue(state), updateMany },
      $queryRaw: queryRaw,
      campaign: { findUnique: vi.fn().mockResolvedValue(null) },
      volunteerTrip: { findUnique: vi.fn().mockResolvedValue({ fundraiserId: 'fundraiser-1', status: tripStatus }) },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(async () => []),
      },
    },
    state,
    rows,
    queryRaw,
  };
}

function createRequest(
  body: unknown = { proofReference: 'TRX-trip-1', proofNote: 'Ditransfer via BCA, dicocokkan dengan nominal.' },
): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/test-trip/payouts/payout-1/complete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function routeContext(id = 'payout-1') {
  return { params: Promise.resolve({ slug: 'test-trip', id }) };
}

describe('POST /api/volunteer-trips/[slug]/payouts/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1' });
    mockPayoutFindUnique.mockResolvedValue({ volunteerTripId: 'trip-1' });
    mockPayoutFindUniqueOrThrow.mockResolvedValue(
      makeApprovedTripPayout({ status: 'COMPLETED', completedById: 'admin-2', completedAt: new Date('2026-03-01') }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 without the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1', assignments: [] } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns 404 when the payout does not belong to this trip', async () => {
    mockPayoutFindUnique.mockResolvedValue({ volunteerTripId: 'another-trip' });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns 404 for a Campaign-linked payout -- never completed through the Trip route', async () => {
    mockPayoutFindUnique.mockResolvedValue({ volunteerTripId: null });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('completes the Trip payout, locking VolunteerTrip and never Campaign', async () => {
    const { tx, state, rows, queryRaw } = makeTx({ payout: makeApprovedTripPayout() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      id: 'payout-1',
      volunteerTripId: 'trip-1',
      status: 'COMPLETED',
      approvedById: 'admin-1',
      completedById: 'admin-2',
    });
    expect(state).toMatchObject({ status: 'COMPLETED', completedById: 'admin-2' });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([
      expect.objectContaining({ account: 'PAYOUT_CLEARING', direction: 'DEBIT', amount: 250_000 }),
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 250_000 }),
    ]);
    const lockedSql = queryRaw.mock.calls[0][0].join('');
    expect(lockedSql).toContain('VolunteerTrip');
    expect(lockedSql).not.toContain('"Campaign"');
  });

  it('completes regardless of the Trip status -- a Trip keeps its own rule, which has no status check (ADR 0014)', async () => {
    for (const tripStatus of ['OPEN', 'CLOSED', 'CANCELLED']) {
      const { tx, state } = makeTx({ payout: makeApprovedTripPayout(), tripStatus });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const response = await POST(createRequest(), routeContext());

      expect(response.status).toBe(200);
      expect(state).toMatchObject({ status: 'COMPLETED' });
    }
  });

  it('refuses completion with 403 BANK_ACCOUNT_NOT_ELIGIBLE when the bank account lost its verification after approval, posting nothing', async () => {
    // The Trip side of the same gate. Verification can be revoked for an
    // account discovered fraudulent, and nothing has been sent until this
    // step, so the destination has to be re-checked here too.
    const { tx, state, rows, queryRaw } = makeTx({
      payout: makeApprovedTripPayout({ bankAccount: { ...makeApprovedTripPayout().bankAccount, verifiedAt: null } }),
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('BANK_ACCOUNT_NOT_ELIGIBLE');
    expect(state).toMatchObject({ status: 'APPROVED', completedById: null });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it('refuses the Admin who approved it, and the Trip Fundraiser, both with 403', async () => {
    for (const actor of ['admin-1', 'fundraiser-1']) {
      mockGetServerSession.mockResolvedValue({ user: { id: actor, assignments: ['ADMIN'] } });
      const { tx, state, rows } = makeTx({ payout: makeApprovedTripPayout() });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const response = await POST(createRequest(), routeContext());
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(['TWO_PERSON_RULE', 'OWN_TRIP_CONFLICT']).toContain(data.code);
      expect(state).toMatchObject({ status: 'APPROVED', completedById: null });
      expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
    }
  });
});
