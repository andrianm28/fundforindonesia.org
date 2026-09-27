import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    prayer: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockFindMany = vi.mocked(prisma.prayer.findMany);
const mockCount = vi.mocked(prisma.prayer.count);

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('GET /api/prayers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated prayers with default parameters', async () => {
    const mockPrayers = [
      {
        id: 'prayer-1',
        text: 'Semoga cepat sembuh',
        amiinCount: 5,
        donationId: 'donation-1',
        campaignId: 'campaign-1',
        userId: 'user-1',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        user: { name: 'John Doe', avatar: '/avatar.jpg' },
        campaign: { slug: 'bantu-anak', title: 'Bantu Anak Sakit' },
        donation: { isAnonymous: false },
      },
    ];

    mockFindMany.mockResolvedValue(mockPrayers as never);
    mockCount.mockResolvedValue(1);

    const request = createRequest('http://localhost:3000/api/prayers');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.prayers).toHaveLength(1);
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(10);
    expect(data.totalPages).toBe(1);
  });

  it('maps prayer data correctly for non-anonymous donation', async () => {
    const mockPrayers = [
      {
        id: 'prayer-1',
        text: 'Semoga cepat sembuh',
        amiinCount: 5,
        donationId: 'donation-1',
        campaignId: 'campaign-1',
        userId: 'user-1',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        user: { name: 'John Doe', avatar: '/avatar.jpg' },
        campaign: { slug: 'bantu-anak', title: 'Bantu Anak Sakit' },
        donation: { isAnonymous: false },
      },
    ];

    mockFindMany.mockResolvedValue(mockPrayers as never);
    mockCount.mockResolvedValue(1);

    const request = createRequest('http://localhost:3000/api/prayers');
    const response = await GET(request);
    const data = await response.json();

    const prayer = data.prayers[0];
    expect(prayer.id).toBe('prayer-1');
    expect(prayer.text).toBe('Semoga cepat sembuh');
    expect(prayer.amiinCount).toBe(5);
    expect(prayer.donorName).toBe('John Doe');
    expect(prayer.donorAvatar).toBe('/avatar.jpg');
    expect(prayer.campaignSlug).toBe('bantu-anak');
    expect(prayer.campaignTitle).toBe('Bantu Anak Sakit');
  });

  it('returns "Anonim" for anonymous donations', async () => {
    const mockPrayers = [
      {
        id: 'prayer-2',
        text: 'Semoga diberikan kesembuhan',
        amiinCount: 3,
        donationId: 'donation-2',
        campaignId: 'campaign-1',
        userId: 'user-2',
        createdAt: new Date('2024-01-15T09:00:00Z'),
        user: { name: 'Jane Doe', avatar: '/jane.jpg' },
        campaign: { slug: 'bantu-anak', title: 'Bantu Anak Sakit' },
        donation: { isAnonymous: true },
      },
    ];

    mockFindMany.mockResolvedValue(mockPrayers as never);
    mockCount.mockResolvedValue(1);

    const request = createRequest('http://localhost:3000/api/prayers');
    const response = await GET(request);
    const data = await response.json();

    const prayer = data.prayers[0];
    expect(prayer.donorName).toBe('Anonim');
    expect(prayer.donorAvatar).toBeNull();
  });

  it('returns "Anonim" when user is null (guest donor)', async () => {
    const mockPrayers = [
      {
        id: 'prayer-3',
        text: 'Semoga dimudahkan',
        amiinCount: 0,
        donationId: 'donation-3',
        campaignId: 'campaign-1',
        userId: null,
        createdAt: new Date('2024-01-15T08:00:00Z'),
        user: null,
        campaign: { slug: 'bantu-anak', title: 'Bantu Anak Sakit' },
        donation: { isAnonymous: false },
      },
    ];

    mockFindMany.mockResolvedValue(mockPrayers as never);
    mockCount.mockResolvedValue(1);

    const request = createRequest('http://localhost:3000/api/prayers');
    const response = await GET(request);
    const data = await response.json();

    const prayer = data.prayers[0];
    expect(prayer.donorName).toBe('Anonim');
    expect(prayer.donorAvatar).toBeNull();
  });

  it('applies pagination correctly', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(25);

    const request = createRequest('http://localhost:3000/api/prayers?page=2&limit=5');
    const response = await GET(request);
    const data = await response.json();

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
      })
    );
    expect(data.page).toBe(2);
    expect(data.limit).toBe(5);
    expect(data.totalPages).toBe(5);
  });

  it('clamps limit to max 50', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/prayers?limit=100');
    const response = await GET(request);
    const data = await response.json();

    expect(data.limit).toBe(50);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it('clamps page to minimum 1', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/prayers?page=0');
    const response = await GET(request);
    const data = await response.json();

    expect(data.page).toBe(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    );
  });

  it('orders prayers by createdAt desc', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/prayers');
    await GET(request);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('includes correct relations', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/prayers');
    await GET(request);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          user: { select: { name: true, avatar: true } },
          campaign: { select: { slug: true, title: true } },
          donation: { select: { isAnonymous: true } },
        },
      })
    );
  });

  it('sets Cache-Control header', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/prayers');
    const response = await GET(request);

    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    );
  });

  it('names no Demo Campaign when it answers for the whole platform', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/prayers');
    await GET(request);

    // Every entry in this feed links to the Campaign it names, so the feed
    // may not name one that no public list shows (CONTEXT.md, Demo Campaign).
    const { where } = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(where).toEqual({ campaign: { isDemo: false } });
    expect(mockCount).toHaveBeenCalledWith({ where: { campaign: { isDemo: false } } });
  });

  it('answers about the one Campaign asked for by slug, Demo or not', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/prayers?campaignSlug=bantu-anak');
    await GET(request);

    // That Campaign's own page is still open and badges itself, so its
    // Prayers stay where the page shows them.
    const { where } = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(where).toEqual({ campaign: { slug: 'bantu-anak' } });
  });

  it('returns 500 on database error', async () => {
    mockFindMany.mockRejectedValue(new Error('DB error'));

    const request = createRequest('http://localhost:3000/api/prayers');
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Failed to fetch prayers');
  });
});
