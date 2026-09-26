import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    volunteerBatch: {
      findMany: vi.fn(),
    },
    registration: {
      count: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

// Submitting is submitTrip's (src/lib/volunteer/trip.ts), tested there: the
// status under the lock, the owner-only Capacity, the log. This route only
// calls it and maps the result.
vi.mock('@/lib/volunteer/trip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/volunteer/trip')>();
  return { ...actual, submitTrip: vi.fn() };
});

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { submitTrip } from '@/lib/volunteer/trip';
import { NotAuthorizedError } from '@/lib/capacity';
import { TripNotEditableError, TripNotFoundError } from '@/lib/volunteer-trip-errors';
import { PATCH, GET } from './route';

const mockSubmitTrip = submitTrip as unknown as Mock;

const mockFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockUpdate = prisma.volunteerTrip.updateMany as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockBatchFindMany = prisma.volunteerBatch.findMany as unknown as Mock;
const mockRegistrationCount = prisma.registration.count as unknown as Mock;

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug') {
  return { params: Promise.resolve({ slug }) };
}

describe('PATCH /api/volunteer-trips/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR' } });
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'DRAFT' });
    mockUpdate.mockResolvedValue({ count: 1 });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ title: 'x' }), routeContext());
    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent slug', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ title: 'x' }), routeContext());
    expect(response.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-owning Fundraiser', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await PATCH(patchRequest({ title: 'x' }), routeContext());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('allows an Admin (the ADMIN assignment, without the Role) to edit a Trip they do not own', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'DONOR', assignments: ['ADMIN'] } });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(200);
  });

  it('refuses someone with the ADMIN Role but no ADMIN assignment on a Trip they do not own', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'legacy-admin', role: 'ADMIN', assignments: [] } });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('allows the owning Fundraiser to edit fields while DRAFT', async () => {
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Updated title' }) }),
    );
  });

  it('allows editing while REJECTED', async () => {
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'REJECTED' });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(200);
  });

  it('writes an edit only while the Trip is Draft or Rejected, judged by the write itself', async () => {
    await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'trip-1', status: { in: ['DRAFT', 'REJECTED'] } },
      data: { title: 'Updated title' },
    });
  });

  it.each([
    ['read as ACTIVE', 'ACTIVE'],
    ['read as DRAFT but submitted before the write', 'DRAFT'],
  ])('returns 400 when editing a Trip %s', async (_case, status) => {
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status });
    mockUpdate.mockResolvedValue({ count: 0 });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Trip tidak bisa diedit pada status ini' });
  });

  describe('action "submit"', () => {
    const submitted = { id: 'trip-1', status: 'SUBMITTED', title: 'Updated title' };

    beforeEach(() => {
      mockSubmitTrip.mockResolvedValue({ trip: submitted });
    });

    it('calls submitTrip with the session as actor and the fields sent with it as edits', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR', assignments: [] } });
      const response = await PATCH(patchRequest({ action: 'submit', title: 'Updated title' }), routeContext());
      expect(response.status).toBe(200);
      expect(mockSubmitTrip).toHaveBeenCalledWith(prisma, {
        tripId: 'trip-1',
        actor: { userId: 'owner-1', assignments: [] },
        edits: { title: 'Updated title' },
      });
      expect(await response.json()).toEqual({ trip: submitted });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('leaves the status judgement to submitTrip: no pre-read status check', async () => {
      mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'ACTIVE' });
      mockSubmitTrip.mockRejectedValue(new TripNotEditableError('ACTIVE'));
      const response = await PATCH(patchRequest({ action: 'submit' }), routeContext());
      expect(mockSubmitTrip).toHaveBeenCalled();
      expect(response.status).toBe(409);
    });

    it.each([
      [new TripNotEditableError('SUBMITTED'), 409, 'TRIP_NOT_EDITABLE'],
      [new NotAuthorizedError('Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.'), 403, 'NOT_AUTHORIZED'],
      [new TripNotFoundError('trip-1'), 404, 'TRIP_NOT_FOUND'],
    ])('answers the refusal %s through domainErrorToHttp', async (error, status, code) => {
      mockSubmitTrip.mockRejectedValue(error);
      const response = await PATCH(patchRequest({ action: 'submit' }), routeContext());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: error.message, code });
    });

    it('answers an unexpected failure with a 500', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSubmitTrip.mockRejectedValue(new Error('database down'));
      const response = await PATCH(patchRequest({ action: 'submit' }), routeContext());
      expect(response.status).toBe(500);
      consoleError.mockRestore();
    });
  });

  it('ignores a client-supplied status field entirely -- cannot be used to jump straight to ACTIVE', async () => {
    const response = await PATCH(patchRequest({ title: 'x', status: 'ACTIVE' }), routeContext());
    expect(response.status).toBe(200);
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it('returns 400 for an unknown action value', async () => {
    const response = await PATCH(patchRequest({ action: 'publish' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSubmitTrip).not.toHaveBeenCalled();
  });
});

function getRequest(slug = 'some-slug'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/volunteer-trips/${slug}`);
}

describe('GET /api/volunteer-trips/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({
      id: 'trip-1',
      slug: 'some-slug',
      status: 'ACTIVE',
      title: 'Mengajar di Pulau Terpencil',
    });
    mockBatchFindMany.mockResolvedValue([
      { id: 'batch-1', tripId: 'trip-1', status: 'OPEN', maxQuota: 20 },
    ]);
    mockRegistrationCount.mockResolvedValue(0);
  });

  it('returns 404 for a nonexistent slug', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns 404 for a non-ACTIVE trip, with the same error body as a nonexistent slug', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'trip-1',
      slug: 'some-slug',
      status: 'DRAFT',
      title: 'Mengajar di Pulau Terpencil',
    });
    const response = await GET(getRequest(), routeContext());
    const data = await response.json();
    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Volunteer trip tidak ditemukan' });

    mockFindUnique.mockResolvedValue(null);
    const notFoundResponse = await GET(getRequest(), routeContext());
    const notFoundData = await notFoundResponse.json();
    expect(notFoundResponse.status).toBe(404);
    expect(notFoundData).toEqual(data);
  });

  it('returns the trip with its OPEN batches, each carrying a remainingQuota field', async () => {
    const response = await GET(getRequest(), routeContext());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.trip.slug).toBe('some-slug');
    expect(data.trip.batches).toEqual([
      expect.objectContaining({ id: 'batch-1', maxQuota: 20, remainingQuota: 20 }),
    ]);
    expect(mockBatchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tripId: 'trip-1', status: 'OPEN' }) }),
    );
  });

  it('does not require authentication', async () => {
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(200);
  });

  it('remainingQuota reflects real HOLD+CONFIRMED counts, not just maxQuota', async () => {
    mockBatchFindMany.mockResolvedValue([{ id: 'batch-1', tripId: 'trip-1', status: 'OPEN', maxQuota: 20 }]);
    mockRegistrationCount.mockResolvedValue(5);

    const response = await GET(getRequest(), routeContext());
    const data = await response.json();

    expect(data.trip.batches[0].remainingQuota).toBe(15);
    expect(mockRegistrationCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ batchId: 'batch-1', status: { in: ['HOLD', 'CONFIRMED'] } }),
      }),
    );
  });
});
