import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { GET } from './route';

const mockFindMany = prisma.volunteerTrip.findMany as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function listRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/moderasi/volunteer-trips');
}

describe('GET /api/moderasi/volunteer-trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    mockFindMany.mockResolvedValue([{ id: 'trip-1', status: 'SUBMITTED' }]);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(listRequest());
    expect(response.status).toBe(401);
  });

  it('returns 403 for a user without the VERIFIER assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', role: 'MODERATOR', assignments: [] } });
    const response = await GET(listRequest());
    expect(response.status).toBe(403);
  });

  it('queries only SUBMITTED trips', async () => {
    await GET(listRequest());
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'SUBMITTED' }) }),
    );
  });

  it('returns the submitted trips', async () => {
    const response = await GET(listRequest());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.trips).toEqual([{ id: 'trip-1', status: 'SUBMITTED' }]);
  });
});
