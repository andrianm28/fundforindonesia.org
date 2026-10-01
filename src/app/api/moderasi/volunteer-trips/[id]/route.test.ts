import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

// The rules (status, Capacity, lock, log, notification) are the module's and
// are tested there (src/lib/volunteer/trip.test.ts). This route only calls
// decideTripSubmission and maps its result.
vi.mock('@/lib/prisma', () => ({ prisma: { tag: 'prisma' } }));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/volunteer/trip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/volunteer/trip')>();
  return { ...actual, decideTripSubmission: vi.fn() };
});

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { decideTripSubmission } from '@/lib/volunteer/trip';
import { OwnSubjectConflictError } from '@/lib/capacity';
import { TripNotFoundError, TripNotSubmittedError, TripRejectionReasonInvalidError } from '@/lib/volunteer-trip-errors';
import { PATCH } from './route';

const mockDecide = decideTripSubmission as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function actionRequest(action: string, reason?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/moderasi/volunteer-trips/trip-1', {
    method: 'PATCH',
    body: JSON.stringify(reason === undefined ? { action } : { action, reason }),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(id = 'trip-1') {
  return { params: Promise.resolve({ id }) };
}

const decidedTrip = { id: 'trip-1', slug: 'trip-slug', title: 'Trip title', fundraiserId: 'owner-1', status: 'ACTIVE' };

describe('PATCH /api/moderasi/volunteer-trips/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    mockDecide.mockResolvedValue({ trip: decidedTrip });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(401);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('returns 403 for a user without the VERIFIER assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', assignments: [] } });
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(403);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid action', async () => {
    const response = await PATCH(actionRequest('suspend'), routeContext());
    expect(response.status).toBe(400);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it.each(['approve', 'reject'] as const)('passes %s to decideTripSubmission with the session as actor', async (action) => {
    const response = await PATCH(actionRequest(action), routeContext());
    expect(response.status).toBe(200);
    expect(mockDecide).toHaveBeenCalledWith(prisma, {
      tripId: 'trip-1',
      actor: { userId: 'verifier-1', assignments: ['VERIFIER'] },
      decision: action,
      reason: undefined,
    });
    expect(await response.json()).toEqual({ trip: decidedTrip });
  });

  it('passes the reason of a rejection through to decideTripSubmission', async () => {
    const response = await PATCH(actionRequest('reject', 'Itinerary belum jelas'), routeContext());
    expect(response.status).toBe(200);
    expect(mockDecide).toHaveBeenCalledWith(prisma, {
      tripId: 'trip-1',
      actor: { userId: 'verifier-1', assignments: ['VERIFIER'] },
      decision: 'reject',
      reason: 'Itinerary belum jelas',
    });
  });

  it('answers 422 for a rejection without a reason, as the module refuses it', async () => {
    const error = new TripRejectionReasonInvalidError('Alasan penolakan wajib diisi.');
    mockDecide.mockRejectedValue(error);
    const response = await PATCH(actionRequest('reject'), routeContext());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: error.message, code: 'TRIP_REJECTION_REASON_INVALID' });
  });

  it.each([
    [new TripNotFoundError('trip-1'), 404, 'TRIP_NOT_FOUND'],
    [new OwnSubjectConflictError('trip', 'VERIFIER'), 403, 'OWN_TRIP_CONFLICT'],
    [new TripNotSubmittedError(), 409, 'TRIP_NOT_SUBMITTED'],
  ])('answers the refusal %s through domainErrorToHttp', async (error, status, code) => {
    mockDecide.mockRejectedValue(error);
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: error.message, code });
  });

  it('lets an unexpected failure through as a 500', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDecide.mockRejectedValue(new Error('database down'));
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(500);
    consoleError.mockRestore();
  });
});
