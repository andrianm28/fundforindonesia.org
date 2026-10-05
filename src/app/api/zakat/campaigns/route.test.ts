import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    // Public progress asks for the beta Gross to take back out of the counter
    // (counted-payment.ts); none is seeded unless a test says so.
    payment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockFindMany = vi.mocked(prisma.campaign.findMany);
const mockCount = vi.mocked(prisma.campaign.count);

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/zakat/campaigns');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return new NextRequest(url);
}

describe('GET /api/zakat/campaigns', () => {
  it('shows the stored counter less what beta Payments put into it (ticket rilis-1-benda/92)', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'z1', title: 'Z', category: 'zakat', collectedAmount: 500_000, creator: { name: 'x' } },
    ] as never);
    mockCount.mockResolvedValue(1);
    vi.mocked(prisma.payment.findMany).mockResolvedValueOnce([
      { amount: 120_000, donation: { campaignId: 'z1' } },
    ] as never);

    const data = await (await GET(createRequest())).json();

    expect(data.campaigns[0].collectedAmount).toBe(380_000);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return paginated zakat campaigns', async () => {
    const mockCampaigns = [
      {
        id: '1',
        title: 'Zakat Mal Campaign',
        category: 'zakat',
        creator: { name: 'User 1' },
      },
    ];

    mockFindMany.mockResolvedValue(mockCampaigns as never);
    mockCount.mockResolvedValue(1);

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.campaigns).toEqual(mockCampaigns);
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(12);
    expect(data.totalPages).toBe(1);
  });

  it('should filter by zakat or kemanusiaan category', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest();
    await GET(request);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { category: 'zakat' },
            { category: 'kemanusiaan' },
          ],
        }),
      })
    );
  });

  it('should support pagination parameters', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(25);

    const request = createRequest({ page: '2', limit: '5' });
    const response = await GET(request);
    const data = await response.json();

    expect(data.page).toBe(2);
    expect(data.limit).toBe(5);
    expect(data.totalPages).toBe(5);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
      })
    );
  });

  it('should set cache control headers', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest();
    const response = await GET(request);

    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    );
  });
});
