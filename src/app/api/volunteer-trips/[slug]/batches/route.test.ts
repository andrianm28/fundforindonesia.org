import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/volunteer/trip', () => ({
  createBatch: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { createBatch } from '@/lib/volunteer/trip';
import { BatchFieldsInvalidError, TripNotAcceptingBatchesError } from '@/lib/volunteer-trip-errors';
import { NotAuthorizedError } from '@/lib/capacity';
import { POST } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockCreateBatch = createBatch as unknown as Mock;
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
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1' });
    mockCreateBatch.mockResolvedValue({ batch: { id: 'batch-1', tripId: 'trip-1', status: 'OPEN' } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(401);
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent trip slug', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(404);
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-owning Fundraiser', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it('lets an Admin (the ADMIN assignment, without the Role) add a Batch to a Trip they do not own', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'ops-1', role: 'DONOR', assignments: ['ADMIN'] } });
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(201);
    expect(mockCreateBatch).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ actor: { userId: 'ops-1', assignments: ['ADMIN'] } }),
    );
  });

  it('refuses someone with the ADMIN Role but no ADMIN assignment on a Trip they do not own', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'legacy-admin', role: 'ADMIN', assignments: [] } });
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('NOT_AUTHORIZED');
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it('calls createBatch with the Trip, the actor and the dates parsed, and answers 201 with the Batch', async () => {
    const response = await POST(createRequest({ ...VALID_BATCH, status: 'CLOSED' }), routeContext());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'batch-1', tripId: 'trip-1', status: 'OPEN' });
    expect(mockCreateBatch).toHaveBeenCalledWith(prisma, {
      tripId: 'trip-1',
      actor: { userId: 'owner-1', assignments: [] },
      fields: {
        startDate: new Date(VALID_BATCH.startDate),
        endDate: new Date(VALID_BATCH.endDate),
        registrationDeadline: new Date(VALID_BATCH.registrationDeadline),
        maxQuota: 20,
        minQuota: 8,
      },
    });
  });

  it.each([
    ['a non-positive maxQuota', { maxQuota: 0 }],
    ['a date that is not ISO', { startDate: 'besok' }],
  ])('returns 400 for %s without calling createBatch', async (_, override) => {
    const response = await POST(createRequest({ ...VALID_BATCH, ...override }), routeContext());
    expect(response.status).toBe(400);
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it('maps a field refusal to 400 with the field named', async () => {
    mockCreateBatch.mockRejectedValue(new BatchFieldsInvalidError('minQuota', 'minQuota tidak boleh melebihi maxQuota'));
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'minQuota tidak boleh melebihi maxQuota',
      code: 'BATCH_FIELDS_INVALID',
      fieldErrors: { minQuota: ['minQuota tidak boleh melebihi maxQuota'] },
    });
  });

  it.each([
    ['TripNotAcceptingBatchesError', new TripNotAcceptingBatchesError('CANCELLED'), 400, 'TRIP_NOT_ACCEPTING_BATCHES'],
    ['NotAuthorizedError', new NotAuthorizedError(), 403, 'NOT_AUTHORIZED'],
  ])('maps %s through domainErrorToHttp', async (_, error, status, code) => {
    mockCreateBatch.mockRejectedValue(error);
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
  });

  it('answers 500 for anything that is not a refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreateBatch.mockRejectedValue(new Error('db down'));
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(500);
  });
});
