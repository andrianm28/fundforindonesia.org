import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { POST, GET } from './route';

const mockCreate = prisma.volunteerTrip.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockFindMany = prisma.volunteerTrip.findMany as unknown as Mock;
const mockCount = prisma.volunteerTrip.count as unknown as Mock;

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
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1', role: 'DONOR' } });
    mockCreate.mockResolvedValue({ id: 'trip-1', slug: 'mengajar-di-pulau-terpencil-ab12cd', ...VALID_BODY, status: 'DRAFT', fundraiserId: 'user-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('lets a registered user with no Role or assignment create a Trip (FFI-04)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', role: 'DONOR', assignments: [] } });
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].data.fundraiserId).toBe('user-2');
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

  it('ignores a client-supplied status on create -- always DRAFT', async () => {
    const response = await POST(createRequest({ ...VALID_BODY, status: 'ACTIVE' }));
    expect(response.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].data.status).toBe('DRAFT');
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

function listRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/volunteer-trips${query}`);
}

describe('GET /api/volunteer-trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([{ id: 'trip-1', slug: 'trip-1', status: 'ACTIVE' }]);
    mockCount.mockResolvedValue(1);
  });

  it('only ever queries status ACTIVE, regardless of any query param', async () => {
    await GET(listRequest('?status=SUBMITTED'));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });

  it('returns paginated results with defaults', async () => {
    const response = await GET(listRequest());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual(expect.objectContaining({ trips: expect.any(Array), total: 1, page: 1 }));
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 12 }));
  });

  it('clamps an out-of-range limit to the maximum', async () => {
    await GET(listRequest('?limit=500'));
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('does not require authentication', async () => {
    const response = await GET(listRequest());
    expect(response.status).toBe(200);
  });
});
