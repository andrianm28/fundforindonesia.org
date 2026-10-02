import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/volunteer/trip', () => ({
  cancelRegistration: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { cancelRegistration } from '@/lib/volunteer/trip';
import { PaymentSubjectMismatchError } from '@/lib/money/refunds';
import {
  BatchAlreadyCompletedError,
  RegistrationNotCancellableError,
  RegistrationNotFoundError,
} from '@/lib/volunteer-trip-errors';
import { PATCH } from './route';

const mockGetServerSession = getServerSession as unknown as Mock;
const mockCancelRegistration = cancelRegistration as unknown as Mock;

function patchRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/registrations/reg-1', { method: 'PATCH' });
}

function routeContext(id = 'reg-1') {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/registrations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'volunteer-1' } });
    mockCancelRegistration.mockResolvedValue({
      registration: { id: 'reg-1', status: 'CANCELLED' },
      refund: { id: 'refund-1', amount: 100_000, status: 'REQUESTED', reason: 'Volunteer membatalkan Registrasi' },
    });
  });

  it('returns 401 when unauthenticated, cancelling nothing', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockCancelRegistration).not.toHaveBeenCalled();
  });

  it('asks the module to cancel the Registration as the signed-in Volunteer, and answers the Refund it made', async () => {
    const response = await PATCH(patchRequest(), routeContext());

    expect(mockCancelRegistration).toHaveBeenCalledWith(prisma, {
      registrationId: 'reg-1',
      actor: { userId: 'volunteer-1' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'reg-1',
      status: 'CANCELLED',
      refund: { id: 'refund-1', amount: 100_000, status: 'REQUESTED' },
    });
  });

  it('answers a null refund when none was owed', async () => {
    mockCancelRegistration.mockResolvedValue({ registration: { id: 'reg-1', status: 'CANCELLED' }, refund: null });
    const response = await PATCH(patchRequest(), routeContext());
    expect(await response.json()).toEqual({ id: 'reg-1', status: 'CANCELLED', refund: null });
  });

  it.each([
    ['RegistrationNotFoundError', new RegistrationNotFoundError('reg-1'), 404, 'REGISTRATION_NOT_FOUND'],
    ['RegistrationNotCancellableError', new RegistrationNotCancellableError('CANCELLED'), 400, 'REGISTRATION_NOT_CANCELLABLE'],
    ['BatchAlreadyCompletedError', new BatchAlreadyCompletedError(), 400, 'BATCH_ALREADY_COMPLETED'],
  ])('answers %s with %i through domainErrorToHttp', async (_name, error, status, code) => {
    mockCancelRegistration.mockRejectedValue(error);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  it('returns 500 when the Refund cannot be created for the Payment the cancel found', async () => {
    mockCancelRegistration.mockRejectedValue(new PaymentSubjectMismatchError('payment-1'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(500);
    consoleErrorSpy.mockRestore();
  });
});
