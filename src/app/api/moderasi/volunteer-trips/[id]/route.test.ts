import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const prisma: Record<string, unknown> = {
    volunteerTrip: { findUnique: vi.fn(), updateMany: vi.fn() },
    notification: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { PATCH } from './route';

const mockFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockUpdateMany = prisma.volunteerTrip.updateMany as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function actionRequest(action: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/moderasi/volunteer-trips/trip-1', {
    method: 'PATCH',
    body: JSON.stringify({ action }),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(id = 'trip-1') {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/moderasi/volunteer-trips/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', title: 'Trip title', slug: 'trip-slug', status: 'SUBMITTED' });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockNotificationCreate.mockResolvedValue({});
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(401);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 403 for a user without the VERIFIER assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', role: 'MODERATOR', assignments: [] } });
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent trip', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(404);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid action', async () => {
    const response = await PATCH(actionRequest('suspend'), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('approve sets status to ACTIVE and notifies the Fundraiser', async () => {
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'trip-1', status: 'SUBMITTED' }, data: { status: 'ACTIVE' } }),
    );
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'owner-1' }) }),
    );
  });

  it('reject sets status to REJECTED and notifies the Fundraiser', async () => {
    const response = await PATCH(actionRequest('reject'), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'trip-1', status: 'SUBMITTED' }, data: { status: 'REJECTED' } }),
    );
    expect(mockNotificationCreate).toHaveBeenCalled();
  });

  describe("a Verifier who is the Trip's Fundraiser", () => {
    beforeEach(() => {
      mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'verifier-1', title: 'Trip title', slug: 'trip-slug', status: 'SUBMITTED' });
    });

    it.each(['approve', 'reject'])('is refused on %s with the Verifier-worded own-Trip conflict', async (action) => {
      const response = await PATCH(actionRequest(action), routeContext());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error:
          'Anda tidak dapat bertindak sebagai Verifier atas Volunteer Trip milik Anda sendiri. Tindakan ini harus dilakukan Verifier lain.',
        code: 'OWN_TRIP_CONFLICT',
      });
      expect(mockUpdateMany).not.toHaveBeenCalled();
      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });
  });

  describe('a Trip that is not Submitted', () => {
    const NOT_SUBMITTED = ['DRAFT', 'REJECTED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED'];
    const cases = NOT_SUBMITTED.flatMap((status) => ['approve', 'reject'].map((action) => [action, status]));

    it.each(cases)('%s from %s is refused with 409 and nothing is written', async (action, status) => {
      mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', title: 'Trip title', slug: 'trip-slug', status });
      const response = await PATCH(actionRequest(action), routeContext());
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'Volunteer Trip ini tidak sedang menunggu keputusan Verifier. Muat ulang halaman lalu periksa kembali.',
        code: 'TRIP_NOT_SUBMITTED',
      });
      expect(mockUpdateMany).not.toHaveBeenCalled();
      expect(mockNotificationCreate).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['approve', 'Volunteer Trip Disetujui', 'Volunteer Trip Anda telah disetujui dan kini aktif'],
    ['reject', 'Volunteer Trip Ditolak', 'Volunteer Trip Anda ditolak'],
  ])('%s tells the Fundraiser in Indonesian, without calling the Verifier a moderator', async (action, title, message) => {
    await PATCH(actionRequest(action), routeContext());
    const { data } = mockNotificationCreate.mock.calls[0][0];
    expect(data).toMatchObject({ title, message });
  });

  it('of two Verifiers deciding a Submitted Trip at once, one changes it and the other gets 409', async () => {
    // One Trip row whose status write honours the predicate, and a gate that
    // lets both requests read it (SUBMITTED) before either one writes.
    let stored = 'SUBMITTED';
    let arrived = 0;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    mockFindUnique.mockImplementation(async () => {
      const row = { id: 'trip-1', fundraiserId: 'owner-1', title: 'Trip title', slug: 'trip-slug', status: stored };
      if (++arrived === 2) openGate();
      await gate;
      return row;
    });
    mockUpdateMany.mockImplementation(async ({ where, data }) => {
      if (where.status !== stored) return { count: 0 };
      stored = data.status;
      return { count: 1 };
    });

    const responses = await Promise.all([
      PATCH(actionRequest('approve'), routeContext()),
      PATCH(actionRequest('reject'), routeContext()),
    ]);

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const refused = responses.find((r) => r.status === 409)!;
    expect((await refused.json()).code).toBe('TRIP_NOT_SUBMITTED');
    expect(['ACTIVE', 'REJECTED']).toContain(stored);
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
  });
});

