import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn(), update: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { PATCH } from './route';

const mockFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockUpdate = prisma.volunteerTrip.update as unknown as Mock;
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
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', title: 'Trip title', slug: 'trip-slug' });
    mockUpdate.mockResolvedValue({ id: 'trip-1', status: 'ACTIVE', slug: 'trip-slug' });
    mockNotificationCreate.mockResolvedValue({});
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 for a user without the VERIFIER assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', role: 'MODERATOR', assignments: [] } });
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent trip', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid action', async () => {
    const response = await PATCH(actionRequest('suspend'), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('approve sets status to ACTIVE and notifies the Fundraiser', async () => {
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'trip-1' }, data: { status: 'ACTIVE' } }),
    );
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'owner-1' }) }),
    );
  });

  it('reject sets status to REJECTED and notifies the Fundraiser', async () => {
    mockUpdate.mockResolvedValue({ id: 'trip-1', status: 'REJECTED', slug: 'trip-slug' });
    const response = await PATCH(actionRequest('reject'), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'trip-1' }, data: { status: 'REJECTED' } }),
    );
    expect(mockNotificationCreate).toHaveBeenCalled();
  });
});
