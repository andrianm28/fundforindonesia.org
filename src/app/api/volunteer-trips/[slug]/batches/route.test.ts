import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    volunteerBatch: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { POST } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockBatchCreate = prisma.volunteerBatch.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

const VALID_BATCH = {
  startDate: '2026-12-01T00:00:00.000Z',
  endDate: '2026-12-05T00:00:00.000Z',
  registrationDeadline: '2026-11-20T00:00:00.000Z',
  maxQuota: 20,
  minQuota: 8,
};

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug/batches', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug') {
  return { params: Promise.resolve({ slug }) };
}

describe('POST /api/volunteer-trips/[slug]/batches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR' } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'DRAFT' });
    mockBatchCreate.mockResolvedValue({ id: 'batch-1', tripId: 'trip-1', ...VALID_BATCH, status: 'OPEN' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(401);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent trip slug', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(404);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-owning Fundraiser', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('creates an OPEN Batch for the owning Fundraiser', async () => {
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(201);
    expect(mockBatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tripId: 'trip-1', status: 'OPEN', maxQuota: 20, minQuota: 8 }),
      }),
    );
  });

  it('ignores a client-supplied status on create -- always OPEN', async () => {
    const response = await POST(createRequest({ ...VALID_BATCH, status: 'CLOSED' }), routeContext());
    expect(response.status).toBe(201);
    expect(mockBatchCreate.mock.calls[0][0].data.status).toBe('OPEN');
  });

  it('returns 400 when minQuota exceeds maxQuota', async () => {
    const response = await POST(createRequest({ ...VALID_BATCH, minQuota: 25 }), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when registrationDeadline is after startDate', async () => {
    const response = await POST(
      createRequest({ ...VALID_BATCH, registrationDeadline: '2026-12-02T00:00:00.000Z' }),
      routeContext(),
    );
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when endDate is before startDate', async () => {
    const response = await POST(
      createRequest({ ...VALID_BATCH, endDate: '2026-11-30T00:00:00.000Z' }),
      routeContext(),
    );
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-positive maxQuota', async () => {
    const response = await POST(createRequest({ ...VALID_BATCH, maxQuota: 0 }), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for adding a batch to a CANCELLED trip', async () => {
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'CANCELLED' });
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('allows adding a batch to an ACTIVE trip', async () => {
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'ACTIVE' });
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(201);
  });
});
