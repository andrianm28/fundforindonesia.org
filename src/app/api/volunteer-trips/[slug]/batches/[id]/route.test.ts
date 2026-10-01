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
  editBatch: vi.fn(),
  cancelBatch: vi.fn(),
  completeBatch: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { cancelBatch, completeBatch, editBatch } from '@/lib/volunteer/trip';
import {
  BatchFieldsInvalidError,
  BatchMinQuotaMetError,
  BatchNotEndedError,
  BatchNotFoundError,
  BatchNotOpenError,
} from '@/lib/volunteer-trip-errors';
import { NotAuthorizedError } from '@/lib/capacity';
import { PATCH } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockEditBatch = editBatch as unknown as Mock;
const mockCancelBatch = cancelBatch as unknown as Mock;
const mockCompleteBatch = completeBatch as unknown as Mock;

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

const OPERATION = { tripId: 'trip-1', batchId: 'batch-1', actor: { userId: 'owner-1', assignments: [] } };

describe('PATCH /api/volunteer-trips/[slug]/batches/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR' } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1' });
    mockEditBatch.mockResolvedValue({ batch: { id: 'batch-1', maxQuota: 25, status: 'OPEN' } });
    mockCancelBatch.mockResolvedValue({ batch: { id: 'batch-1', status: 'CANCELLED' }, refunds: [] });
    mockCompleteBatch.mockResolvedValue({ batch: { id: 'batch-1', status: 'COMPLETED' } });
  });

  describe('who may', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
      expect(response.status).toBe(401);
      expect(mockEditBatch).not.toHaveBeenCalled();
    });

    it('returns 404 when the trip does not exist', async () => {
      mockTripFindUnique.mockResolvedValue(null);
      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      expect(response.status).toBe(404);
      expect(mockCancelBatch).not.toHaveBeenCalled();
    });

    it.each([{ maxQuota: 25 }, { action: 'cancel' }, { action: 'complete' }])(
      'returns 403 for a non-owning Fundraiser (%o), calling no operation',
      async (body) => {
        mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
        const response = await PATCH(patchRequest(body), routeContext());
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
          code: 'NOT_AUTHORIZED',
        });
        expect(mockEditBatch).not.toHaveBeenCalled();
        expect(mockCancelBatch).not.toHaveBeenCalled();
        expect(mockCompleteBatch).not.toHaveBeenCalled();
      },
    );

    it('lets an Admin who does not own the Trip edit, as themselves', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'DONOR', assignments: ['ADMIN'] } });
      const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
      expect(response.status).toBe(200);
      expect(mockEditBatch).toHaveBeenCalled();
    });

    it('refuses an Admin who does not own the Trip completing a Batch with 403, with or without a list', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'DONOR', assignments: ['ADMIN'] } });
      for (const body of [{ action: 'complete' }, { action: 'complete', attendedRegistrationIds: [] }]) {
        const response = await PATCH(patchRequest(body), routeContext());
        expect(response.status).toBe(403);
      }
      expect(mockCompleteBatch).not.toHaveBeenCalled();
    });

    it('refuses someone with the ADMIN Role but no ADMIN assignment who does not own the Trip', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: 'legacy-admin', role: 'ADMIN', assignments: [] } });
      const response = await PATCH(patchRequest({ action: 'complete' }), routeContext());
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe('NOT_AUTHORIZED');
      expect(mockCompleteBatch).not.toHaveBeenCalled();
    });
  });

  describe('edit', () => {
    it('calls editBatch with the parsed edits, ignoring a client-supplied status', async () => {
      const response = await PATCH(
        patchRequest({ maxQuota: 25, endDate: '2026-12-09T00:00:00.000Z', status: 'CANCELLED' }),
        routeContext(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ batch: { id: 'batch-1', maxQuota: 25, status: 'OPEN' } });
      expect(mockEditBatch).toHaveBeenCalledWith(prisma, {
        ...OPERATION,
        edits: {
          maxQuota: 25,
          startDate: undefined,
          endDate: new Date('2026-12-09T00:00:00.000Z'),
          registrationDeadline: undefined,
        },
      });
    });

    it('returns 400 for a malformed edit without calling editBatch', async () => {
      const response = await PATCH(patchRequest({ maxQuota: -1 }), routeContext());
      expect(response.status).toBe(400);
      expect(mockEditBatch).not.toHaveBeenCalled();
    });

    it('maps a field refusal to 400 with the field named', async () => {
      mockEditBatch.mockRejectedValue(new BatchFieldsInvalidError('endDate', 'endDate tidak boleh sebelum startDate'));
      const response = await PATCH(patchRequest({ endDate: '2026-11-25T00:00:00.000Z' }), routeContext());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'endDate tidak boleh sebelum startDate',
        code: 'BATCH_FIELDS_INVALID',
        fieldErrors: { endDate: ['endDate tidak boleh sebelum startDate'] },
      });
    });
  });

  describe('cancel action', () => {
    it('calls cancelBatch and answers the Batch and every Refund it created', async () => {
      mockCancelBatch.mockResolvedValue({
        batch: { id: 'batch-1', status: 'CANCELLED', maxQuota: 20 },
        refunds: [
          { registrationId: 'reg-a', refundId: 'refund-a', amount: 100_000 },
          { registrationId: 'reg-b', refundId: 'refund-b', amount: 250_000 },
        ],
      });

      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());

      expect(response.status).toBe(200);
      expect(mockCancelBatch).toHaveBeenCalledWith(prisma, OPERATION);
      expect(mockEditBatch).not.toHaveBeenCalled();
      expect(await response.json()).toEqual({
        batch: { id: 'batch-1', status: 'CANCELLED' },
        refundedRegistrations: [
          { registrationId: 'reg-a', refundId: 'refund-a', amount: 100_000 },
          { registrationId: 'reg-b', refundId: 'refund-b', amount: 250_000 },
        ],
      });
    });
  });

  describe('complete action', () => {
    it('calls completeBatch and answers the Batch', async () => {
      const response = await PATCH(patchRequest({ action: 'complete', attendedRegistrationIds: [] }), routeContext());

      expect(response.status).toBe(200);
      expect(mockCompleteBatch).toHaveBeenCalledWith(prisma, { ...OPERATION, attendedRegistrationIds: [] });
      expect(await response.json()).toEqual({ batch: { id: 'batch-1', status: 'COMPLETED' } });
    });

    it('answers 400 for complete without an attendance list, completing nothing', async () => {
      const response = await PATCH(patchRequest({ action: 'complete' }), routeContext());

      expect(response.status).toBe(400);
      expect(mockCompleteBatch).not.toHaveBeenCalled();
    });

    it('passes the attended Registration ids to completeBatch', async () => {
      const response = await PATCH(
        patchRequest({ action: 'complete', attendedRegistrationIds: ['reg-a', 'reg-b'] }),
        routeContext(),
      );

      expect(response.status).toBe(200);
      expect(mockCompleteBatch).toHaveBeenCalledWith(prisma, {
        ...OPERATION,
        attendedRegistrationIds: ['reg-a', 'reg-b'],
      });
    });

    it('answers 400 for an attendance list that is not an array of ids, completing nothing', async () => {
      const response = await PATCH(
        patchRequest({ action: 'complete', attendedRegistrationIds: 'reg-a' }),
        routeContext(),
      );

      expect(response.status).toBe(400);
      expect(mockCompleteBatch).not.toHaveBeenCalled();
    });

    it('maps the Admin-not-owner refusal of attendance to 403', async () => {
      mockCompleteBatch.mockRejectedValue(new NotAuthorizedError());
      const response = await PATCH(
        patchRequest({ action: 'complete', attendedRegistrationIds: [] }),
        routeContext(),
      );

      expect(response.status).toBe(403);
    });
  });

  it.each([
    ['BatchNotFoundError', new BatchNotFoundError('batch-1'), 404, 'BATCH_NOT_FOUND'],
    ['BatchNotOpenError', new BatchNotOpenError('CLOSED'), 409, 'BATCH_NOT_OPEN'],
    ['BatchMinQuotaMetError', new BatchMinQuotaMetError(), 400, 'BATCH_MIN_QUOTA_MET'],
    ['BatchNotEndedError', new BatchNotEndedError(), 400, 'BATCH_NOT_ENDED'],
    ['NotAuthorizedError', new NotAuthorizedError(), 403, 'NOT_AUTHORIZED'],
  ])('maps %s through domainErrorToHttp', async (_, error, status, code) => {
    mockCancelBatch.mockRejectedValue(error);
    const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: error.message, code });
  });

  it('answers 500 for anything that is not a refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCompleteBatch.mockRejectedValue(new Error('db down'));
    const response = await PATCH(patchRequest({ action: 'complete', attendedRegistrationIds: [] }), routeContext());
    expect(response.status).toBe(500);
  });
});
