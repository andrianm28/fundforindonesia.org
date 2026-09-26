import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { NextRequest } from 'next/server';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from '@/lib/auth';

import { prisma } from '@/lib/prisma';

const mockFindMany = vi.mocked(prisma.campaign.findMany);
const mockCount = vi.mocked(prisma.campaign.count);
const mockCreate = vi.mocked(prisma.campaign.create);
const mockGetServerSession = vi.mocked(getServerSession);

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('GET /api/campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated campaigns with default parameters', async () => {
    const mockCampaigns = [
      {
        id: '1',
        slug: 'test-campaign',
        title: 'Test Campaign',
        description: 'A test campaign',
        story: 'Story content',
        coverImage: '/img.jpg',
        targetAmount: 1000000,
        collectedAmount: 500000,
        category: 'kesehatan',
        isUrgent: false,
        deadline: null,
        creatorId: 'user1',
        createdAt: new Date(),
        updatedAt: new Date(),
        creator: { name: 'Creator 1' },
      },
    ];

    mockFindMany.mockResolvedValue(mockCampaigns as never);
    mockCount.mockResolvedValue(1);

    const request = createRequest('http://localhost:3000/api/campaigns');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.campaigns).toHaveLength(1);
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(12);
    expect(data.totalPages).toBe(1);
  });

  it('sets Cache-Control header', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/campaigns');
    const response = await GET(request);

    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    );
  });

  it('filters by category', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/campaigns?category=kesehatan');
    await GET(request);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: 'kesehatan' }),
      })
    );
  });

  it('filters by urgent=true', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/campaigns?urgent=true');
    await GET(request);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isUrgent: true }),
      })
    );
  });

  // Regression: `?status=` used to flow straight into the filter, so anyone
  // could list Submitted, Rejected or Suspended Campaigns. The values are the
  // legacy stored strings an attacker would send. Which Campaigns the list
  // returns is pinned against rows in route.listing.test.ts.
  it.each(['pending', 'suspended', 'rejected', 'completed'])(
    'never lets a ?status=%s query reach the filter',
    async (status) => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const request = createRequest(`http://localhost:3000/api/campaigns?status=${status}`);
      await GET(request);

      for (const query of [mockFindMany, mockCount]) {
        const where = query.mock.calls[0][0]?.where;
        expect(where).not.toHaveProperty('status');
        expect(JSON.stringify(where)).not.toContain(status);
      }
    }
  );

  it('performs case-insensitive search on title and description', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/campaigns?search=anak');
    await GET(request);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { title: { contains: 'anak', mode: 'insensitive' } },
            { description: { contains: 'anak', mode: 'insensitive' } },
          ],
        }),
      })
    );
  });

  it('applies pagination correctly', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(25);

    const request = createRequest('http://localhost:3000/api/campaigns?page=2&limit=10');
    const response = await GET(request);
    const data = await response.json();

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      })
    );
    expect(data.page).toBe(2);
    expect(data.limit).toBe(10);
    expect(data.totalPages).toBe(3);
  });

  it("includes only the creator's name: no self-claimed verification is sent (retire-role-hierarchy)", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/campaigns');
    await GET(request);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          creator: {
            select: {
              name: true,
            },
          },
        },
      })
    );
  });

  it('returns 500 on database error', async () => {
    mockFindMany.mockRejectedValue(new Error('DB error'));

    const request = createRequest('http://localhost:3000/api/campaigns');
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Failed to fetch campaigns');
  });

  it('clamps limit to max 50', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const request = createRequest('http://localhost:3000/api/campaigns?limit=100');
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

    const request = createRequest('http://localhost:3000/api/campaigns?page=0');
    const response = await GET(request);
    const data = await response.json();

    expect(data.page).toBe(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    );
  });
});


describe('POST /api/campaigns', () => {
  const validBody = {
    title: 'Bantuan untuk Korban Banjir',
    description: 'Campaign untuk membantu korban banjir',
    story: '<p>Cerita lengkap tentang banjir yang melanda daerah ini...</p>',
    coverImage: 'https://example.com/image.jpg',
    targetAmount: 50000000,
    category: 'bencana-alam',
  };

  const verifiedSession = {
    user: {
      id: 'user-1',
      name: 'John Doe',
      email: 'john@example.com',
    },
    expires: '2099-01-01',
  };

  const noRoleSession = {
    user: {
      id: 'user-2',
      name: 'Jane Doe',
      email: 'jane@example.com',
      assignments: [],
    },
    expires: '2099-01-01',
  };

  function createPostRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost:3000/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPostRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('lets a registered user with no Role or assignment submit a Campaign (FFI-04)', async () => {
    mockGetServerSession.mockResolvedValue(noRoleSession as never);
    mockCreate.mockResolvedValue({ id: 'campaign-2' } as never);

    const request = createPostRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
    const { data } = mockCreate.mock.calls[0][0];
    expect(data.creatorId).toBe('user-2');
    expect(data.lifecycleStatus).toBe('SUBMITTED');
  });

  it('returns 400 with field errors for invalid body', async () => {
    mockGetServerSession.mockResolvedValue(verifiedSession as never);

    const invalidBody = {
      title: '', // empty title
      description: '',
      story: '',
      coverImage: 'not-a-url',
      targetAmount: -100,
      category: '',
    };

    const request = createPostRequest(invalidBody);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Validasi gagal');
    expect(data.fieldErrors).toBeDefined();
    expect(data.fieldErrors.title).toBeDefined();
    expect(data.fieldErrors.coverImage).toBeDefined();
    expect(data.fieldErrors.targetAmount).toBeDefined();
  });

  it('returns 400 if title exceeds 200 characters', async () => {
    mockGetServerSession.mockResolvedValue(verifiedSession as never);

    const longTitleBody = {
      ...validBody,
      title: 'a'.repeat(201),
    };

    const request = createPostRequest(longTitleBody);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.fieldErrors.title).toBeDefined();
  });

  it('creates campaign successfully with valid data', async () => {
    mockGetServerSession.mockResolvedValue(verifiedSession as never);

    const mockCampaign = {
      id: 'campaign-1',
      slug: 'bantuan-untuk-korban-banjir-abc123',
      ...validBody,
      collectedAmount: 0,
      isUrgent: false,
      deadline: null,
      creatorId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      creator: { name: 'John Doe' },
    };

    mockCreate.mockResolvedValue(mockCampaign as never);

    const request = createPostRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toBe('campaign-1');
    expect(data.title).toBe(validBody.title);
    expect(data.creatorId).toBe('user-1');
  });

  it('creates the campaign as Submitted so it cannot publish itself', async () => {
    // A campaign must pass a Verifier before it is visible. Creating it as
    // Active would publish an unverified appeal for money under the
    // platform's name, and would also leave the /moderasi queue -- which
    // lists Submitted Campaigns -- permanently empty.
    mockGetServerSession.mockResolvedValue(verifiedSession as never);
    mockCreate.mockResolvedValue({ id: 'campaign-1' } as never);

    const request = createPostRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
    const { data } = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.lifecycleStatus).toBe('SUBMITTED');
    // The legacy status string is neither written nor sent back
    // (legacy-status-contract 02).
    expect(data).not.toHaveProperty('status');
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ omit: { status: true } });
  });

  it('passes correct data to prisma.campaign.create', async () => {
    mockGetServerSession.mockResolvedValue(verifiedSession as never);
    mockCreate.mockResolvedValue({ id: 'c1' } as never);

    const request = createPostRequest(validBody);
    await POST(request);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: validBody.title,
          description: validBody.description,
          story: validBody.story,
          coverImage: validBody.coverImage,
          targetAmount: validBody.targetAmount,
          category: validBody.category,
          creatorId: 'user-1',
          deadline: null,
        }),
        include: {
          creator: {
            select: {
              name: true,
            },
          },
        },
      })
    );
  });

  it('generates a slug from the title', async () => {
    mockGetServerSession.mockResolvedValue(verifiedSession as never);
    mockCreate.mockResolvedValue({ id: 'c1' } as never);

    const request = createPostRequest(validBody);
    await POST(request);

    const createCall = mockCreate.mock.calls[0][0];
    const slug = (createCall as { data: { slug: string } }).data.slug;
    expect(slug).toMatch(/^bantuan-untuk-korban-banjir-[a-z0-9]+$/);
  });

  it('handles optional deadline field', async () => {
    mockGetServerSession.mockResolvedValue(verifiedSession as never);
    mockCreate.mockResolvedValue({ id: 'c1' } as never);

    const bodyWithDeadline = {
      ...validBody,
      deadline: '2025-12-31T23:59:59.000Z',
    };

    const request = createPostRequest(bodyWithDeadline);
    await POST(request);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deadline: new Date('2025-12-31T23:59:59.000Z'),
        }),
      })
    );
  });

  it('returns 500 on database error', async () => {
    mockGetServerSession.mockResolvedValue(verifiedSession as never);
    mockCreate.mockRejectedValue(new Error('DB error'));

    const request = createPostRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Gagal membuat campaign');
  });
});
