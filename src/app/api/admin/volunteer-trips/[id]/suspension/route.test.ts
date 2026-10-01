import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

// The rules (Admin only, never on your own Trip, reason, status, log, lock)
// are the module's and are tested there (src/lib/volunteer/trip-suspension.test.ts).
// This route only calls suspendTrip / liftTripSuspension and maps the result.
vi.mock('@/lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/volunteer/trip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/volunteer/trip')>();
  return { ...actual, suspendTrip: vi.fn(), liftTripSuspension: vi.fn() };
});

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { liftTripSuspension, suspendTrip } from '@/lib/volunteer/trip';
import { NotAuthorizedError, OwnSubjectConflictError } from '@/lib/capacity';
import { LifecycleValidationError, SameAdminLiftError } from '@/lib/campaign-lifecycle-errors';
import { TripNotFoundError, TripNotSuspendableError, TripNotSuspendedError } from '@/lib/volunteer-trip-errors';
import { DELETE, POST } from './route';

const mockSuspend = suspendTrip as unknown as Mock;
const mockLift = liftTripSuspension as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function request(method: 'POST' | 'DELETE', body: unknown = { reason: 'Alasan' }): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/volunteer-trips/trip-1/suspension', {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const context = { params: Promise.resolve({ id: 'trip-1' }) };
const suspendedTrip = { id: 'trip-1', status: 'SUSPENDED' };
const session = { user: { id: 'admin-1', assignments: ['ADMIN'] } };

describe.each([
  ['POST', POST, mockSuspend],
  ['DELETE', DELETE, mockLift],
] as const)('%s /api/admin/volunteer-trips/[id]/suspension', (method, handler, command) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(session);
    command.mockResolvedValue({ trip: suspendedTrip });
  });

  it('returns 401 when unauthenticated, calling nothing', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await handler(request(method), context);
    expect(response.status).toBe(401);
    expect(command).not.toHaveBeenCalled();
  });

  it('passes the Trip id, the session as actor and the reason to the module', async () => {
    const response = await handler(request(method, { reason: 'Laporan penipuan' }), context);
    expect(response.status).toBe(200);
    expect(command).toHaveBeenCalledWith(prisma, {
      tripId: 'trip-1',
      actor: { userId: 'admin-1', assignments: ['ADMIN'] },
      reason: 'Laporan penipuan',
    });
    expect(await response.json()).toEqual({ trip: suspendedTrip });
  });

  it('passes an unreadable body as no reason, for the module to refuse', async () => {
    await handler(request(method, 'bukan json'), context);
    expect(command).toHaveBeenCalledWith(prisma, expect.objectContaining({ reason: undefined }));
  });

  it.each([
    [new NotAuthorizedError('Hanya Admin.'), 403, 'NOT_AUTHORIZED'],
    [new OwnSubjectConflictError('trip', 'ADMIN'), 403, 'OWN_TRIP_CONFLICT'],
    [new LifecycleValidationError('Alasan wajib diisi.', 'reason'), 400, 'VALIDATION'],
    [new TripNotFoundError('trip-1'), 404, 'TRIP_NOT_FOUND'],
    [new TripNotSuspendableError('DRAFT'), 409, 'TRIP_NOT_SUSPENDABLE'],
    [new TripNotSuspendedError('ACTIVE'), 409, 'TRIP_NOT_SUSPENDED'],
    [new SameAdminLiftError(), 403, 'SAME_ADMIN_LIFT'],
  ])('answers the refusal %s through domainErrorToHttp', async (error, status, code) => {
    command.mockRejectedValue(error);
    const response = await handler(request(method), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: error.message, code });
  });

  it('answers an unexpected failure with one Indonesian 500 that leaks nothing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    command.mockRejectedValue(new Error('database down'));
    const response = await handler(request(method), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Terjadi kesalahan pada server.', code: 'INTERNAL_ERROR' });
    consoleError.mockRestore();
  });
});
