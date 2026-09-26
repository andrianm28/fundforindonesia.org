import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    volunteerBatch: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/money/refunds', () => ({
  createRefund: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { createRefund } from '@/lib/money/refunds';
import { PATCH } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockBatchFindUnique = prisma.volunteerBatch.findUnique as unknown as Mock;
const mockBatchUpdate = prisma.volunteerBatch.update as unknown as Mock;
const mockBatchUpdateMany = prisma.volunteerBatch.updateMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockCreateRefund = createRefund as unknown as Mock;

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug/batches/batch-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug', id = 'batch-1') {
  return { params: Promise.resolve({ slug, id }) };
}

function makeCancelTx(
  options: {
    lockedRegistrations?: Array<{ id: string; status: 'HOLD' | 'CONFIRMED' }>;
    confirmedPayments?: Record<string, { id: string; amount: number }>;
    lockedBatchStatus?: string;
  } = {},
) {
  const lockedRegistrations = options.lockedRegistrations ?? [];
  const confirmedPayments = options.confirmedPayments ?? {};
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([{ id: 'batch-1', status: options.lockedBatchStatus ?? 'OPEN' }]) // Batch row lock
    .mockResolvedValueOnce(lockedRegistrations); // Registration rows lock
  const registrationFindMany = vi.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(
      where.id.in
        .filter((id) => confirmedPayments[id])
        .map((id) => ({ id, payment: confirmedPayments[id] })),
    ),
  );
  const registrationUpdateMany = vi.fn().mockResolvedValue({ count: lockedRegistrations.length });
  const volunteerBatchUpdate = vi.fn().mockResolvedValue({ id: 'batch-1', status: 'CANCELLED' });
  return {
    tx: {
      $queryRaw: queryRaw,
      registration: { findMany: registrationFindMany, updateMany: registrationUpdateMany },
      volunteerBatch: { update: volunteerBatchUpdate },
    },
    queryRaw,
    registrationFindMany,
    registrationUpdateMany,
    volunteerBatchUpdate,
  };
}

describe('PATCH /api/volunteer-trips/[slug]/batches/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR' } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1' });
    mockBatchFindUnique.mockResolvedValue({
      id: 'batch-1',
      tripId: 'trip-1',
      status: 'OPEN',
      maxQuota: 20,
      minQuota: 8,
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      endDate: new Date('2026-12-05T00:00:00.000Z'),
      registrationDeadline: new Date('2026-11-20T00:00:00.000Z'),
    });
    mockBatchUpdate.mockResolvedValue({ id: 'batch-1', maxQuota: 25 });
    mockBatchUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(401);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(404);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when the batch does not exist, or does not belong to this trip', async () => {
    mockBatchFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(404);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when the batch belongs to a different trip than the slug names', async () => {
    mockBatchFindUnique.mockResolvedValue({ id: 'batch-1', tripId: 'a-different-trip', status: 'OPEN' });
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(404);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-owning Fundraiser', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('allows the owning Fundraiser to edit an OPEN batch', async () => {
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(200);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ maxQuota: 25 }) }),
    );
  });

  it('returns 400 for editing a CLOSED batch', async () => {
    mockBatchFindUnique.mockResolvedValue({ id: 'batch-1', tripId: 'trip-1', status: 'CLOSED', maxQuota: 20, minQuota: 8 });
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('ignores a client-supplied status field -- cancelling requires the dedicated action: "cancel" body, not a raw status write', async () => {
    const response = await PATCH(patchRequest({ maxQuota: 25, status: 'CANCELLED' }), routeContext());
    expect(response.status).toBe(200);
    const updateCall = mockBatchUpdate.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it('returns 400 when the edited minQuota would exceed the batch\'s own maxQuota', async () => {
    const response = await PATCH(patchRequest({ minQuota: 30 }), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when the edited endDate is before the stored startDate', async () => {
    const response = await PATCH(
      patchRequest({ endDate: '2026-11-25T00:00:00.000Z' }),
      routeContext(),
    );
    expect(response.status).toBe(400);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when the edited registrationDeadline is after the stored startDate', async () => {
    const response = await PATCH(
      patchRequest({ registrationDeadline: '2026-12-02T00:00:00.000Z' }),
      routeContext(),
    );
    expect(response.status).toBe(400);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  describe('cancel action', () => {
    it('returns 403 for a non-owning Fundraiser attempting to cancel', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
        code: 'NOT_AUTHORIZED',
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('returns 400 when the batch is not OPEN', async () => {
      mockBatchFindUnique.mockResolvedValue({ id: 'batch-1', tripId: 'trip-1', status: 'CLOSED', maxQuota: 20, minQuota: 8 });
      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      expect(response.status).toBe(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('returns 400 when the Batch already met its minQuota', async () => {
      const lockedRegistrations = Array.from({ length: 8 }, (_, i) => ({ id: `reg-${i}`, status: 'CONFIRMED' as const }));
      const { tx } = makeCancelTx({ lockedRegistrations });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      expect(response.status).toBe(400);
      expect(mockCreateRefund).not.toHaveBeenCalled();
    });

    it('cancels an under-quota Batch, cancels every CONFIRMED Registration, and refunds each in full', async () => {
      const lockedRegistrations = [
        { id: 'reg-a', status: 'CONFIRMED' as const },
        { id: 'reg-b', status: 'CONFIRMED' as const },
      ];
      const confirmedPayments = {
        'reg-a': { id: 'payment-a', amount: 100_000 },
        'reg-b': { id: 'payment-b', amount: 250_000 },
      };
      const { tx, volunteerBatchUpdate, registrationUpdateMany } = makeCancelTx({ lockedRegistrations, confirmedPayments });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      mockCreateRefund
        .mockResolvedValueOnce({ id: 'refund-a', amount: 100_000, status: 'REQUESTED' })
        .mockResolvedValueOnce({ id: 'refund-b', amount: 250_000, status: 'REQUESTED' });

      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(volunteerBatchUpdate).toHaveBeenCalledWith({ where: { id: 'batch-1' }, data: { status: 'CANCELLED' } });
      expect(registrationUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['reg-a', 'reg-b'] } },
        data: { status: 'CANCELLED' },
      });
      expect(mockCreateRefund).toHaveBeenCalledTimes(2);
      expect(mockCreateRefund).toHaveBeenNthCalledWith(1, expect.anything(), {
        subject: { type: 'trip', tripId: 'trip-1' },
        paymentId: 'payment-a',
        amount: 100_000,
        reason: 'Batch dibatalkan karena tidak mencapai kuota minimum',
        requestedById: 'owner-1',
      });
      expect(mockCreateRefund).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ paymentId: 'payment-b', amount: 250_000 }),
      );
      expect(data.refundedRegistrations).toEqual([
        { registrationId: 'reg-a', refundId: 'refund-a', amount: 100_000 },
        { registrationId: 'reg-b', refundId: 'refund-b', amount: 250_000 },
      ]);
    });

    it('cancels every HOLD Registration on the Batch too, creating no Refund for them', async () => {
      const lockedRegistrations = [
        { id: 'reg-hold', status: 'HOLD' as const },
        { id: 'reg-confirmed', status: 'CONFIRMED' as const },
      ];
      const confirmedPayments = { 'reg-confirmed': { id: 'payment-a', amount: 100_000 } };
      const { tx, registrationUpdateMany } = makeCancelTx({ lockedRegistrations, confirmedPayments });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      mockCreateRefund.mockResolvedValueOnce({ id: 'refund-a', amount: 100_000, status: 'REQUESTED' });

      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(registrationUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['reg-confirmed', 'reg-hold'] } },
        data: { status: 'CANCELLED' },
      });
      expect(mockCreateRefund).toHaveBeenCalledTimes(1);
      expect(mockCreateRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ paymentId: 'payment-a' }));
      expect(data.refundedRegistrations).toEqual([{ registrationId: 'reg-confirmed', refundId: 'refund-a', amount: 100_000 }]);
    });

    it('refunds the full Trip Fee even when the Batch departs imminently -- never the tiered Volunteer-cancel rule', async () => {
      mockBatchFindUnique.mockResolvedValue({
        id: 'batch-1',
        tripId: 'trip-1',
        status: 'OPEN',
        maxQuota: 20,
        minQuota: 8,
        startDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day out -- inside tripFeeRefundAmount's own 0%-tier window
        endDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        registrationDeadline: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      const lockedRegistrations = [{ id: 'reg-a', status: 'CONFIRMED' as const }];
      const confirmedPayments = { 'reg-a': { id: 'payment-a', amount: 100_000 } };
      const { tx } = makeCancelTx({ lockedRegistrations, confirmedPayments });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      mockCreateRefund.mockResolvedValueOnce({ id: 'refund-a', amount: 100_000, status: 'REQUESTED' });

      await PATCH(patchRequest({ action: 'cancel' }), routeContext());

      expect(mockCreateRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 100_000 }));
    });

    it('cancels a Batch with zero HOLD/CONFIRMED Registrations, creating no Refund', async () => {
      const { tx, volunteerBatchUpdate } = makeCancelTx({ lockedRegistrations: [] });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(volunteerBatchUpdate).toHaveBeenCalled();
      expect(mockCreateRefund).not.toHaveBeenCalled();
      expect(data.refundedRegistrations).toEqual([]);
    });

    it('returns 400 when the locked Batch is no longer OPEN (claimed concurrently, e.g. by complete)', async () => {
      const { tx } = makeCancelTx({ lockedBatchStatus: 'COMPLETED' });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      expect(response.status).toBe(400);
      expect(mockCreateRefund).not.toHaveBeenCalled();
    });
  });

  describe('complete action', () => {
    beforeEach(() => {
      mockBatchFindUnique.mockResolvedValue({
        id: 'batch-1',
        tripId: 'trip-1',
        status: 'OPEN',
        maxQuota: 20,
        minQuota: 8,
        startDate: new Date('2026-12-01T00:00:00.000Z'),
        endDate: new Date('2026-01-01T00:00:00.000Z'), // already in the past
        registrationDeadline: new Date('2026-11-20T00:00:00.000Z'),
      });
    });

    it('returns 403 for a non-owning Fundraiser attempting to complete', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
      const response = await PATCH(patchRequest({ action: 'complete' }), routeContext());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
        code: 'NOT_AUTHORIZED',
      });
      expect(mockBatchUpdateMany).not.toHaveBeenCalled();
    });

    it('allows the owning Fundraiser to complete a Batch whose endDate has passed', async () => {
      mockBatchUpdateMany.mockResolvedValue({ count: 1 });
      const response = await PATCH(patchRequest({ action: 'complete' }), routeContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockBatchUpdateMany).toHaveBeenCalledWith({
        where: { id: 'batch-1', status: 'OPEN' },
        data: { status: 'COMPLETED' },
      });
      expect(data).toEqual({ batch: { id: 'batch-1', status: 'COMPLETED' } });
    });

    it('allows an Admin who does not own the Trip to complete a Batch', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
      mockBatchUpdateMany.mockResolvedValue({ count: 1 });
      const response = await PATCH(patchRequest({ action: 'complete' }), routeContext());
      expect(response.status).toBe(200);
      expect(mockBatchUpdateMany).toHaveBeenCalled();
    });

    it('returns 400 when the Batch endDate has not passed yet', async () => {
      mockBatchFindUnique.mockResolvedValue({
        id: 'batch-1',
        tripId: 'trip-1',
        status: 'OPEN',
        maxQuota: 20,
        minQuota: 8,
        startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // still in the future
        registrationDeadline: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      const response = await PATCH(patchRequest({ action: 'complete' }), routeContext());
      expect(response.status).toBe(400);
      expect(mockBatchUpdateMany).not.toHaveBeenCalled();
    });

    it('returns 400 when the Batch is already CANCELLED', async () => {
      mockBatchFindUnique.mockResolvedValue({
        id: 'batch-1',
        tripId: 'trip-1',
        status: 'CANCELLED',
        maxQuota: 20,
        minQuota: 8,
        startDate: new Date('2026-12-01T00:00:00.000Z'),
        endDate: new Date('2026-01-01T00:00:00.000Z'),
        registrationDeadline: new Date('2026-11-20T00:00:00.000Z'),
      });
      const response = await PATCH(patchRequest({ action: 'complete' }), routeContext());
      expect(response.status).toBe(400);
      expect(mockBatchUpdate).not.toHaveBeenCalled();
    });

    it('returns 400 when the Batch is CLOSED (not OPEN)', async () => {
      mockBatchFindUnique.mockResolvedValue({
        id: 'batch-1',
        tripId: 'trip-1',
        status: 'CLOSED',
        maxQuota: 20,
        minQuota: 8,
        startDate: new Date('2026-12-01T00:00:00.000Z'),
        endDate: new Date('2026-01-01T00:00:00.000Z'),
        registrationDeadline: new Date('2026-11-20T00:00:00.000Z'),
      });
      const response = await PATCH(patchRequest({ action: 'complete' }), routeContext());
      expect(response.status).toBe(400);
      expect(mockBatchUpdate).not.toHaveBeenCalled();
    });

    it('returns 409 when the Batch is no longer OPEN by the time complete claims it', async () => {
      mockBatchUpdateMany.mockResolvedValue({ count: 0 });
      const response = await PATCH(patchRequest({ action: 'complete' }), routeContext());
      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toBeTruthy();
    });
  });
});
