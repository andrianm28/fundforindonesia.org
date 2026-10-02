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
import { PUBLIC_TRIP_LIST_SELECT } from '@/lib/volunteer/trip-public';
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
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockCreate.mockResolvedValue({ id: 'trip-1', slug: 'mengajar-di-pulau-terpencil-ab12cd', ...VALID_BODY, status: 'DRAFT', fundraiserId: 'user-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('lets a registered user with no Role or assignment create a Trip (FFI-04)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', assignments: [] } });
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].data.fundraiserId).toBe('user-2');
  });

  it('creates a DRAFT Trip owned by the requester', async () => {
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        id: 'trip-1',
        slug: expect.any(String),
        status: 'DRAFT',
        fundraiserId: 'user-1',
        ...VALID_BODY,
      }),
    );
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

  it('accepts the local path /api/upload answers with as the cover image', async () => {
    const response = await POST(createRequest({ ...VALID_BODY, coverImage: '/uploads/lq2k9-abc123.png' }));
    expect(response.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].data.coverImage).toBe('/uploads/lq2k9-abc123.png');
  });

  it.each(['/uploads/../etc/passwd', 'http://example.com/x.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA'])(
    'refuses the unsafe cover image %s',
    async (coverImage) => {
      const response = await POST(createRequest({ ...VALID_BODY, coverImage }));
      expect(response.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );
});

describe('POST /api/volunteer-trips tripFeeAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockCreate.mockResolvedValue({ id: 'trip-1', slug: 'x' });
  });

  it.each([999999999.99, 1500.5, 10_000_001, 2_147_483_647, 0, -1])('rejects %s', async (tripFeeAmount) => {
    const response = await POST(createRequest({ ...VALID_BODY, tripFeeAmount }));
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('accepts exactly Rp10.000.000 (owner decision 2026-10-02)', async () => {
    const response = await POST(createRequest({ ...VALID_BODY, tripFeeAmount: 10_000_000 }));
    expect(response.status).toBe(201);
  });

  it('rejects Rp10.000.001 with an Indonesian message naming the limit', async () => {
    const response = await POST(createRequest({ ...VALID_BODY, tripFeeAmount: 10_000_001 }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('Rp10.000.000');
  });
});


// A Prisma stand-in that honours `select`: with no select the whole row comes
// back, so a route that falls back to a full include/row leaks the field here.
function applySelect<T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>) {
  if (!select) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => select[key] === true));
}

const FULL_TRIP_ROW = {
  id: 'trip-1',
  slug: 'trip-1',
  title: 'Mengajar di Pulau Terpencil',
  description: 'Deskripsi singkat trip.',
  story: 'Cerita lengkap trip.',
  itinerary: 'Hari 1: berangkat.',
  coverImage: 'https://example.com/cover.jpg',
  destination: 'Pulau Terpencil, NTT',
  tripFeeAmount: 1_500_000,
  status: 'ACTIVE',
  fundraiserId: 'user-secret-1',
  fundraiser: { id: 'user-secret-1', email: 'owner@example.com' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function listRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/volunteer-trips${query}`);
}

describe('GET /api/volunteer-trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockImplementation(async (args: { select?: Record<string, boolean> }) => [
      applySelect(FULL_TRIP_ROW, args.select),
    ]);
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

  it('returns exactly the public list fields in the body: no fundraiserId, fundraiser, story, itinerary, status, updatedAt', async () => {
    const response = await GET(listRequest());
    const data = await response.json();
    expect(data.trips).toHaveLength(1);
    expect(Object.keys(data.trips[0]).sort()).toEqual(Object.keys(PUBLIC_TRIP_LIST_SELECT).sort());
    expect(JSON.stringify(data)).not.toContain('user-secret-1');
    expect(JSON.stringify(data)).not.toContain('owner@example.com');
  });

  it('does not require authentication', async () => {
    const response = await GET(listRequest());
    expect(response.status).toBe(200);
  });
});
