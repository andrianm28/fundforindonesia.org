import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    refund: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockRefundFindUnique = prisma.refund.findUnique as unknown as Mock;
const mockRefundFindUniqueOrThrow = prisma.refund.findUniqueOrThrow as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function makeTx(options: { refundRow?: Record<string, unknown> | null; tripFundraiserId?: string } = {}) {
  const state = options.refundRow ? { ...options.refundRow } : null;
  return {
    tx: {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      volunteerTrip: {
        findUnique: vi.fn().mockResolvedValue({ fundraiserId: options.tripFundraiserId ?? 'fundraiser-1', status: 'ACTIVE' }),
      },
      refund: {
        findUnique: vi.fn().mockResolvedValue(state),
        updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
          if (!state || state.status !== where.status) return { count: 0 };
          Object.assign(state, data);
          return { count: 1 };
        }),
      },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    },
  };
}

function makeRefundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    paymentId: 'payment-1',
    amount: 40_000,
    status: 'APPROVED',
    requestedById: 'requester-1',
    approvedById: 'approver-1',
    payment: {
      amount: 100_000,
      providerFee: 5_000,
      escrowReleasedAt: null,
      donation: null,
      registration: { batch: { tripId: 'trip-1' } },
    },
    ...overrides,
  };
}

const validBody = {
  proofReference: 'TRX-1',
  proofNote: 'Ditransfer via mobile banking BCA, dicocokkan dengan nama dan rekening Donor.',
  donorBankCode: 'BCA',
  donorAccountName: 'Budi Santoso',
  donorAccountNumber: '1234567890',
};

function postRequest(body: Record<string, unknown> = validBody): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/bersih-pantai/refunds/refund-1/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function routeContext(id = 'refund-1') {
  return { params: Promise.resolve({ slug: 'bersih-pantai', id }) };
}

describe('POST /api/volunteer-trips/[slug]/refunds/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-3', assignments: ['ADMIN'] } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1' });
    mockRefundFindUnique.mockResolvedValue({ payment: { registration: { batch: { tripId: 'trip-1' } } } });
    mockRefundFindUniqueOrThrow.mockResolvedValue(makeRefundRow({ status: 'COMPLETED', completedById: 'admin-3' }));
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(postRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', assignments: ['VERIFIER'] } });
    const response = await POST(postRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it("returns 404 when the Refund's Payment belongs to a different Trip than the URL slug", async () => {
    mockRefundFindUnique.mockResolvedValue({ payment: { registration: { batch: { tripId: 'a-different-trip' } } } });
    const response = await POST(postRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the Refund's Payment is Campaign-linked, not Trip-linked at all", async () => {
    mockRefundFindUnique.mockResolvedValue({ payment: { registration: null } });
    const response = await POST(postRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the refund id does not exist at all', async () => {
    mockRefundFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('completes an APPROVED refund and returns 200 with the updated status', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('COMPLETED');
  });

  it('returns 403 TWO_PERSON_RULE when the completer is the Admin who requested it', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'requester-1', assignments: ['ADMIN'] } });
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(), routeContext());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('TWO_PERSON_RULE');
  });

  it('returns 403 TWO_PERSON_RULE when the completer is the Admin who approved it', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'approver-1', assignments: ['ADMIN'] } });
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(), routeContext());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('TWO_PERSON_RULE');
  });

  it("returns 403 OWN_TRIP_CONFLICT when the completing Admin is the Trip's own Fundraiser", async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow(), tripFundraiserId: 'admin-3' });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'OWN_TRIP_CONFLICT' });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('returns 404 REFUND_NOT_FOUND when the Refund is gone by the time completion reads it', async () => {
    const { tx } = makeTx({ refundRow: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(), routeContext());

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('REFUND_NOT_FOUND');
  });

  it('returns 409 when the refund is no longer APPROVED', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow({ status: 'REQUESTED' }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(), routeContext());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('INVALID_REFUND_STATUS');
  });
});
