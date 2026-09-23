import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    volunteerBatch: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { PATCH } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockBatchFindUnique = prisma.volunteerBatch.findUnique as unknown as Mock;
const mockBatchUpdate = prisma.volunteerBatch.update as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

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

  it('ignores a client-supplied status field -- no cancel action exists on this route', async () => {
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
});
