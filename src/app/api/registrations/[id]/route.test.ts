import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    registration: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/money/refunds', () => ({
  createRefund: vi.fn(),
  PaymentNotFoundError: class PaymentNotFoundError extends Error {},
  PaymentSubjectMismatchError: class PaymentSubjectMismatchError extends Error {},
  RefundExceedsRemainingError: class RefundExceedsRemainingError extends Error {},
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { createRefund, PaymentSubjectMismatchError } from '@/lib/money/refunds';
import { PATCH } from './route';

const mockFindUnique = prisma.registration.findUnique as unknown as Mock;
const mockUpdateMany = prisma.registration.updateMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockCreateRefund = createRefund as unknown as Mock;

function patchRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/registrations/reg-1', { method: 'PATCH' });
}

function routeContext(id = 'reg-1') {
  return { params: Promise.resolve({ id }) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function registrationFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reg-1',
    volunteerId: 'volunteer-1',
    status: 'CONFIRMED',
    batch: { tripId: 'trip-1', startDate: new Date(Date.now() + 20 * DAY_MS), status: 'OPEN' },
    payment: { id: 'payment-1', amount: 100_000 },
    ...overrides,
  };
}

describe('PATCH /api/registrations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'volunteer-1' } });
    mockFindUnique.mockResolvedValue(registrationFixture());
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({ registration: { updateMany: mockUpdateMany } }),
    );
    mockCreateRefund.mockResolvedValue({ id: 'refund-1', amount: 100_000, status: 'REQUESTED' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the registration does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns 403 when the Registration belongs to a different Volunteer', async () => {
    mockFindUnique.mockResolvedValue(registrationFixture({ volunteerId: 'someone-else' }));
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 for a Registration that is already CANCELLED', async () => {
    mockFindUnique.mockResolvedValue(registrationFixture({ status: 'CANCELLED' }));
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 for a Registration that is EXPIRED', async () => {
    mockFindUnique.mockResolvedValue(registrationFixture({ status: 'EXPIRED' }));
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when the Batch has already COMPLETED', async () => {
    mockFindUnique.mockResolvedValue(
      registrationFixture({ batch: { tripId: 'trip-1', startDate: new Date(Date.now() + 20 * DAY_MS), status: 'COMPLETED' } }),
    );
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('cancels a HOLD Registration with no Refund created', async () => {
    mockFindUnique.mockResolvedValue(registrationFixture({ status: 'HOLD', payment: null }));
    const response = await PATCH(patchRequest(), routeContext());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual({ id: 'reg-1', status: 'CANCELLED', refund: null });
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('cancels a CONFIRMED Registration far from departure with a full Refund', async () => {
    const response = await PATCH(patchRequest(), routeContext());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(mockCreateRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subject: { type: 'trip', tripId: 'trip-1' },
        paymentId: 'payment-1',
        amount: 100_000,
        requestedById: 'volunteer-1',
      }),
    );
    expect(data.refund).toEqual({ id: 'refund-1', amount: 100_000, status: 'REQUESTED' });
  });

  it('cancels a CONFIRMED Registration inside the mid tier with a half Refund', async () => {
    mockFindUnique.mockResolvedValue(
      registrationFixture({ batch: { tripId: 'trip-1', startDate: new Date(Date.now() + 5 * DAY_MS) } }),
    );
    await PATCH(patchRequest(), routeContext());
    expect(mockCreateRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 50_000 }));
  });

  it('cancels a CONFIRMED Registration inside the no-refund window with no Refund created -- proving self-cancel never gets the Batch-cancel full-refund rule', async () => {
    mockFindUnique.mockResolvedValue(
      registrationFixture({ batch: { tripId: 'trip-1', startDate: new Date(Date.now() + DAY_MS) } }),
    );
    const response = await PATCH(patchRequest(), routeContext());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.refund).toBeNull();
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('returns 409, creating no Refund, when the cancel race is lost to a concurrent update', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(409);
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('returns 500 when createRefund reports the Payment does not match the Trip subject', async () => {
    mockCreateRefund.mockRejectedValue(new PaymentSubjectMismatchError('payment-1'));
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(500);
  });
});
