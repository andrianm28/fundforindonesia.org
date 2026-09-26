import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    payment: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/payments', () => ({
  getPaymentProvider: vi.fn(),
  PaymentProviderNotConfiguredError: class extends Error {},
}));

vi.mock('@/lib/volunteer/trip', () => ({
  holdRegistration: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments';
import { holdRegistration } from '@/lib/volunteer/trip';
import {
  AlreadyRegisteredError,
  BatchFullError,
  BatchNotFoundError,
  BatchNotTakingRegistrationsError,
  RegistrationDeadlinePassedError,
  TripNotTakingRegistrationsError,
} from '@/lib/volunteer-trip-errors';
import { POST } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockPaymentCreate = prisma.payment.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;
const mockHoldRegistration = holdRegistration as unknown as Mock;

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
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1' });
    mockGetPaymentProvider.mockReturnValue({
      name: 'sumopod',
      method: 'qris_redirect',
      createCharge: vi.fn().mockResolvedValue({
        method: 'qris_redirect',
        redirectUrl: 'https://pay.example/x',
        expiresAt: new Date('2026-12-01'),
      }),
    });
    mockHoldRegistration.mockResolvedValue({
      registration: { id: 'registration-1', volunteerId: 'volunteer-1', batchId: 'batch-1', status: 'HOLD' },
      tripFeeAmount: 1_500_000,
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
  });

  it('returns 404 when no Trip has the URL slug, holding nothing', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext('wrong-slug'));
    expect(response.status).toBe(404);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
  });

  it('asks the module to hold a seat on the Batch of the URL Trip for the signed-in Volunteer', async () => {
    await POST(createRequest(), routeContext());
    expect(mockTripFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'some-slug' } }));
    expect(mockHoldRegistration).toHaveBeenCalledWith(prisma, {
      tripId: 'trip-1',
      batchId: 'batch-1',
      volunteerId: 'volunteer-1',
    });
  });

  it('charges the Trip Fee the hold named and records a PENDING Payment for it', async () => {
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(201);
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
    expect(await response.json()).toMatchObject({ registrationId: 'registration-1', amount: 1_500_000 });
  });

  it.each([
    ['BatchNotFoundError', new BatchNotFoundError('batch-1'), 404, 'BATCH_NOT_FOUND'],
    ['TripNotTakingRegistrationsError', new TripNotTakingRegistrationsError('SUSPENDED'), 400, 'TRIP_NOT_TAKING_REGISTRATIONS'],
    ['BatchNotTakingRegistrationsError', new BatchNotTakingRegistrationsError('CLOSED'), 400, 'BATCH_NOT_TAKING_REGISTRATIONS'],
    ['RegistrationDeadlinePassedError', new RegistrationDeadlinePassedError(), 400, 'REGISTRATION_DEADLINE_PASSED'],
    ['BatchFullError', new BatchFullError(), 400, 'BATCH_FULL'],
    ['AlreadyRegisteredError', new AlreadyRegisteredError(), 400, 'ALREADY_REGISTERED'],
  ])('answers %s with %i through domainErrorToHttp, charging nothing', async (_name, error, status, code) => {
    mockHoldRegistration.mockRejectedValue(error);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it('returns 503 when the payment provider is not configured, holding nothing', async () => {
    const { PaymentProviderNotConfiguredError } = await import('@/lib/payments');
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError('PAYMENT_PROVIDER');
    });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(503);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown payment method, holding nothing', async () => {
    const response = await POST(createRequest({ paymentMethod: 'cash' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockHoldRegistration).not.toHaveBeenCalled();
  });
});
