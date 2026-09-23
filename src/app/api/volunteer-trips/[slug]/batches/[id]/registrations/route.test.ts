import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerBatch: { findUnique: vi.fn() },
    registration: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    payment: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/payments', () => ({
  getPaymentProvider: vi.fn(),
  PaymentProviderNotConfiguredError: class extends Error {},
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments';
import { POST } from './route';

const mockBatchFindUnique = prisma.volunteerBatch.findUnique as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;
const mockRegistrationFindMany = prisma.registration.findMany as unknown as Mock;
const mockRegistrationUpdateMany = prisma.registration.updateMany as unknown as Mock;
const mockRegistrationCount = prisma.registration.count as unknown as Mock;
const mockRegistrationFindFirst = prisma.registration.findFirst as unknown as Mock;
const mockRegistrationCreate = prisma.registration.create as unknown as Mock;
const mockPaymentCreate = prisma.payment.create as unknown as Mock;

function createRequest(body: unknown = { paymentMethod: 'qris' }): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug/batches/batch-1/registrations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug', id = 'batch-1') {
  return { params: Promise.resolve({ slug, id }) };
}

describe('POST /api/volunteer-trips/[slug]/batches/[id]/registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'volunteer-1' } });
    mockBatchFindUnique.mockResolvedValue({
      id: 'batch-1',
      status: 'OPEN',
      maxQuota: 20,
      registrationDeadline: new Date('2026-12-31'),
      trip: { id: 'trip-1', slug: 'some-slug', status: 'ACTIVE', tripFeeAmount: 1_500_000 },
    });
    mockGetPaymentProvider.mockReturnValue({
      name: 'sumopod',
      method: 'qris_redirect',
      createCharge: vi.fn().mockResolvedValue({
        method: 'qris_redirect',
        redirectUrl: 'https://pay.example/x',
        expiresAt: new Date('2026-12-01'),
      }),
    });
    // releaseExpiredHolds runs at the top of every request -- give it
    // nothing to sweep by default so tests exercise the registration logic,
    // not the sweep itself (that's registration.test.ts's job).
    mockRegistrationFindMany.mockResolvedValue([]);
    mockRegistrationUpdateMany.mockResolvedValue({ count: 0 });
    // tx and prisma are the same mocked object here (see mockTransaction
    // below), matching src/app/api/admin/users/[id]/assignments/route.test.ts's
    // established pattern for a transaction whose tx client needs no ledger
    // simulation -- unlike the payout/escrow transactions, nothing here
    // reads a derived financial aggregate that a fake tx would need to
    // compute for real.
    mockTransaction.mockImplementation(async (cb) => cb(prisma));
    mockRegistrationCount.mockResolvedValue(0);
    mockRegistrationFindFirst.mockResolvedValue(null);
    mockRegistrationCreate.mockResolvedValue({
      id: 'registration-1',
      volunteerId: 'volunteer-1',
      batchId: 'batch-1',
      status: 'HOLD',
      holdExpiresAt: new Date('2026-09-23T00:30:00.000Z'),
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
  });

  it('returns 404 for a nonexistent batch', async () => {
    mockBatchFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns 400 when the batch is not OPEN', async () => {
    mockBatchFindUnique.mockResolvedValue({
      id: 'batch-1',
      status: 'CLOSED',
      maxQuota: 20,
      registrationDeadline: new Date('2026-12-31'),
      trip: { id: 'trip-1', slug: 'some-slug', status: 'ACTIVE', tripFeeAmount: 1_500_000 },
    });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(400);
  });

  it('returns 400 when the trip is not ACTIVE', async () => {
    mockBatchFindUnique.mockResolvedValue({
      id: 'batch-1',
      status: 'OPEN',
      maxQuota: 20,
      registrationDeadline: new Date('2026-12-31'),
      trip: { id: 'trip-1', slug: 'some-slug', status: 'SUSPENDED', tripFeeAmount: 1_500_000 },
    });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(400);
    expect(mockRegistrationCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when the batch registrationDeadline has passed', async () => {
    mockBatchFindUnique.mockResolvedValue({
      id: 'batch-1',
      status: 'OPEN',
      maxQuota: 20,
      registrationDeadline: new Date('2020-01-01'),
      trip: { id: 'trip-1', slug: 'some-slug', status: 'ACTIVE', tripFeeAmount: 1_500_000 },
    });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(400);
    expect(mockRegistrationCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when the URL slug does not match the batch's trip", async () => {
    const response = await POST(createRequest(), routeContext('wrong-slug', 'batch-1'));
    expect(response.status).toBe(404);
    expect(mockRegistrationCreate).not.toHaveBeenCalled();
  });

  it('returns 400 (Batch full) when HOLD+CONFIRMED count is at maxQuota', async () => {
    mockRegistrationCount.mockResolvedValue(20);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/penuh/i);
    expect(mockRegistrationCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when the same Volunteer already has an open HOLD/CONFIRMED registration on this batch', async () => {
    mockRegistrationFindFirst.mockResolvedValue({ id: 'existing-reg' });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(400);
    expect(mockRegistrationCreate).not.toHaveBeenCalled();
  });

  it('sweeps expired holds on this batch before checking quota', async () => {
    await POST(createRequest(), routeContext());
    expect(mockRegistrationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ batchId: 'batch-1', status: 'HOLD' }),
      }),
    );
  });

  it('locks the Batch row before reading the occupancy count', async () => {
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(201);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('creates a HOLD registration and a PENDING payment for the trip fee amount', async () => {
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(201);
    expect(mockRegistrationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ volunteerId: 'volunteer-1', batchId: 'batch-1', status: 'HOLD' }),
      }),
    );
    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registrationId: 'registration-1',
          donationId: undefined,
          amount: 1_500_000,
          status: 'PENDING',
        }),
      }),
    );
  });

  it('returns 503 when the payment provider is not configured', async () => {
    const { PaymentProviderNotConfiguredError } = await import('@/lib/payments');
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError('PAYMENT_PROVIDER');
    });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(503);
  });

  it('CONCURRENCY: two simultaneous registrations at the last remaining seat -- exactly one succeeds', async () => {
    // Simulate the row lock's serializing effect: the first call to
    // registration.count sees 19 (one seat left, maxQuota 20), the second
    // (running "after" the first's transaction commits, as the real FOR
    // UPDATE lock would force) sees 20 (full). This test proves the ROUTE's
    // logic correctly refuses the second given that count, not that the
    // mocked $transaction itself serializes concurrent JS calls (it can't --
    // real serialization is a Postgres row-lock property this seam cannot
    // exercise; what this test proves is that the code correctly acts on
    // whatever count the lock would have made accurate).
    mockRegistrationCount.mockResolvedValueOnce(19).mockResolvedValueOnce(20);

    const [first, second] = await Promise.all([
      POST(createRequest(), routeContext()),
      POST(createRequest(), routeContext()),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);
  });
});
