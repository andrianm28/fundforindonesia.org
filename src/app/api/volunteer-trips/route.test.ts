import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { POST } from './route';

const mockCreate = prisma.volunteerTrip.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

const VALID_BODY = {
  title: 'Mengajar di Pulau Terpencil',
  description: 'Deskripsi singkat trip.',
  story: 'Cerita lengkap trip.',
  coverImage: 'https://example.com/cover.jpg',
  destination: 'Pulau Terpencil, NTT',
  itinerary: 'Hari 1: berangkat. Hari 2-4: mengajar. Hari 5: pulang.',
  tripFeeAmount: 1_500_000,
};

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/volunteer-trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1', role: 'CAMPAIGN_CREATOR' } });
    mockCreate.mockResolvedValue({ id: 'trip-1', slug: 'mengajar-di-pulau-terpencil-ab12cd', ...VALID_BODY, status: 'DRAFT', fundraiserId: 'user-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 403 for a DONOR (below CAMPAIGN_CREATOR)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', role: 'DONOR' } });
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('allows an ADMIN (above CAMPAIGN_CREATOR in the hierarchy) to create a Trip', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(201);
  });

  it('creates a DRAFT Trip owned by the requester', async () => {
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ...VALID_BODY,
          status: 'DRAFT',
          fundraiserId: 'user-1',
        }),
      }),
    );
  });

  it('returns 400 for a missing required field', async () => {
    const { title: _title, ...withoutTitle } = VALID_BODY;
    const response = await POST(createRequest(withoutTitle));
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-positive tripFeeAmount', async () => {
    const response = await POST(createRequest({ ...VALID_BODY, tripFeeAmount: 0 }));
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid coverImage URL', async () => {
    const response = await POST(createRequest({ ...VALID_BODY, coverImage: 'not-a-url' }));
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
