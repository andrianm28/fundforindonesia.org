import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    registration: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { GET } from './route';

const mockFindMany = prisma.registration.findMany as unknown as Mock;
const mockCount = prisma.registration.count as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function mineRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/registrations/mine${query}`);
}

function makeRow(overrides: Partial<{
  id: string;
  status: 'HOLD' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  batchStatus: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'COMPLETED';
  payment: { amount: number; method: string; status: string } | null;
}> = {}) {
  return {
    id: overrides.id ?? 'reg-1',
    status: overrides.status ?? 'CONFIRMED',
    holdExpiresAt: new Date('2026-11-01T00:00:00.000Z'),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    batch: {
      id: 'batch-1',
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      endDate: new Date('2026-12-05T00:00:00.000Z'),
      status: overrides.batchStatus ?? 'OPEN',
      trip: { title: 'Trip Judul', slug: 'trip-judul', coverImage: null },
    },
    payment:
      overrides.payment === undefined
        ? { amount: 500_000, method: 'qris', status: 'SETTLED' }
        : overrides.payment,
  };
}

describe('GET /api/registrations/mine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'volunteer-1' } });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(mineRequest());
    expect(response.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('scopes the query to the requesting Volunteer only', async () => {
    await GET(mineRequest());
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { volunteerId: 'volunteer-1' } }),
    );
    expect(mockCount).toHaveBeenCalledWith({ where: { volunteerId: 'volunteer-1' } });
  });

  it('returns an empty list with total 0 for a Volunteer with no Registrations', async () => {
    const response = await GET(mineRequest());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual({ registrations: [], total: 0, page: 1, limit: 10, totalPages: 0 });
  });

  it('returns every RegistrationStatus, not just CONFIRMED', async () => {
    const rows = [
      makeRow({ id: 'reg-hold', status: 'HOLD' }),
      makeRow({ id: 'reg-confirmed', status: 'CONFIRMED' }),
      makeRow({ id: 'reg-expired', status: 'EXPIRED' }),
      makeRow({ id: 'reg-cancelled', status: 'CANCELLED' }),
    ];
    mockFindMany.mockResolvedValue(rows);
    mockCount.mockResolvedValue(4);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(data.registrations.map((r: { id: string }) => r.id)).toEqual([
      'reg-hold',
      'reg-confirmed',
      'reg-expired',
      'reg-cancelled',
    ]);
  });

  it('marks a CONFIRMED Registration on a COMPLETED Batch as a completed participation record', async () => {
    mockFindMany.mockResolvedValue([makeRow({ status: 'CONFIRMED', batchStatus: 'COMPLETED' })]);
    mockCount.mockResolvedValue(1);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(data.registrations[0].isCompletedParticipation).toBe(true);
  });

  it('does not mark a CONFIRMED Registration on a still-OPEN Batch', async () => {
    mockFindMany.mockResolvedValue([makeRow({ status: 'CONFIRMED', batchStatus: 'OPEN' })]);
    mockCount.mockResolvedValue(1);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(data.registrations[0].isCompletedParticipation).toBe(false);
  });

  it('does not mark a HOLD Registration on a COMPLETED Batch', async () => {
    mockFindMany.mockResolvedValue([makeRow({ status: 'HOLD', batchStatus: 'COMPLETED' })]);
    mockCount.mockResolvedValue(1);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(data.registrations[0].isCompletedParticipation).toBe(false);
  });

  it('does not mark a CANCELLED Registration on a COMPLETED Batch', async () => {
    mockFindMany.mockResolvedValue([makeRow({ status: 'CANCELLED', batchStatus: 'COMPLETED' })]);
    mockCount.mockResolvedValue(1);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(data.registrations[0].isCompletedParticipation).toBe(false);
  });

  it('passes through a null payment without crashing', async () => {
    mockFindMany.mockResolvedValue([makeRow({ payment: null })]);
    mockCount.mockResolvedValue(1);

    const response = await GET(mineRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.registrations[0].payment).toBeNull();
  });

  it('defaults to page 1, limit 10', async () => {
    await GET(mineRequest());
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 10 }),
    );
  });

  it('honors page and limit query params', async () => {
    await GET(mineRequest('?page=2&limit=5'));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
  });

  it('clamps limit to a maximum of 50', async () => {
    await GET(mineRequest('?limit=500'));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it.each(['page=abc', 'page=0', 'page=-1', 'page=99999999', 'page=1.5', 'limit=abc', 'limit=0', 'limit=-3'])(
    'answers 400, not 500, and queries nothing for ?%s',
    async (query) => {
      const response = await GET(mineRequest(`?${query}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty('error');
      expect(mockFindMany).not.toHaveBeenCalled();
    },
  );

  it('accepts the largest page the bound allows', async () => {
    const response = await GET(mineRequest('?page=10000'));
    expect(response.status).toBe(200);
  });

  it('computes totalPages from total and limit', async () => {
    mockFindMany.mockResolvedValue([makeRow()]);
    mockCount.mockResolvedValue(23);

    const response = await GET(mineRequest('?limit=10'));
    const data = await response.json();

    expect(data).toMatchObject({ total: 23, page: 1, limit: 10, totalPages: 3 });
  });

  it('treats empty query parameters as defaults', async () => {
    const response = await GET(mineRequest('?page=&limit='));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ page: 1, limit: 10 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 10 }),
    );
  });
});
