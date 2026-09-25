import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from './route';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { Prisma } from '@/generated/prisma/client';

const mockFindUnique = vi.mocked(prisma.campaign.findUnique);
const mockUpdate = vi.mocked(prisma.campaign.update);
const mockDelete = vi.mocked(prisma.campaign.delete);
const mockGetServerSession = vi.mocked(getServerSession);

function createRequest(slug: string, method = 'GET', body?: unknown) {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(`http://localhost:3000/api/campaigns/${slug}`, init);
}

// The shape Prisma 7 with @prisma/adapter-pg throws when Postgres refuses a
// write with 23503: code P2003, the violated constraint under
// meta.driverAdapterError.cause.
function foreignKeyViolation(constraint: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `Foreign key constraint violated on the constraint: \`${constraint}\``,
    {
      code: 'P2003',
      clientVersion: '7.8.0',
      meta: {
        driverAdapterError: {
          cause: { kind: 'ForeignKeyConstraintViolation', constraint: { index: constraint } },
        },
      },
    }
  );
}

describe('GET /api/campaigns/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns campaign detail with creator info and donation count', async () => {
    const mockCampaign = {
      id: 'campaign-1',
      slug: 'bantu-korban-bencana',
      title: 'Bantu Korban Bencana',
      description: 'Campaign untuk membantu korban bencana alam',
      story: '<p>Full campaign story here</p>',
      coverImage: 'https://example.com/image.jpg',
      targetAmount: 50000000,
      collectedAmount: 25841000,
      category: 'bencana-alam',
      status: 'active',
      isUrgent: false,
      isDemo: false,
      deadline: new Date('2026-06-06T00:00:00Z'),
      creatorId: 'user-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-06-01T00:00:00Z'),
      creator: {
        id: 'user-1',
        name: 'Yayasan Peduli',
        avatar: null,
        isVerified: true,
        verificationType: 'organization',
      },
      _count: {
        donations: 342,
      },
    };

    mockFindUnique.mockResolvedValue(mockCampaign as any);

    const request = createRequest('bantu-korban-bencana');
    const response = await GET(request, {
      params: Promise.resolve({ slug: 'bantu-korban-bencana' }),
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.campaign).toBeDefined();
    expect(body.campaign.id).toBe('campaign-1');
    expect(body.campaign.slug).toBe('bantu-korban-bencana');
    expect(body.campaign.title).toBe('Bantu Korban Bencana');
    expect(body.campaign.description).toBe('Campaign untuk membantu korban bencana alam');
    expect(body.campaign.story).toBe('<p>Full campaign story here</p>');
    expect(body.campaign.coverImage).toBe('https://example.com/image.jpg');
    expect(body.campaign.targetAmount).toBe(50000000);
    expect(body.campaign.collectedAmount).toBe(25841000);
    expect(body.campaign.category).toBe('bencana-alam');
    expect(body.campaign.status).toBe('active');
    expect(body.campaign.isUrgent).toBe(false);
    expect(body.campaign.isDemo).toBe(false);
    expect(body.campaign.creator).toEqual({
      id: 'user-1',
      name: 'Yayasan Peduli',
      avatar: null,
      isVerified: true,
      verificationType: 'organization',
    });
    expect(body.campaign.donationCount).toBe(342);
  });

  it('passes isDemo through for a demo campaign -- the donate page badge (task M9) depends on this field reaching the client', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'campaign-demo',
      slug: 'campaign-contoh',
      title: 'Campaign Contoh',
      description: 'Contoh',
      story: '<p>Contoh</p>',
      coverImage: 'https://example.com/demo.jpg',
      targetAmount: 10000000,
      collectedAmount: 5000000,
      category: 'bencana-alam',
      status: 'active',
      isUrgent: false,
      isDemo: true,
      deadline: null,
      creatorId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      creator: { id: 'user-1', name: 'Creator', avatar: null, isVerified: false, verificationType: null },
      _count: { donations: 0 },
    } as any);

    const request = createRequest('campaign-contoh');
    const response = await GET(request, {
      params: Promise.resolve({ slug: 'campaign-contoh' }),
    });
    const body = await response.json();

    expect(body.campaign.isDemo).toBe(true);
  });

  it('returns 404 with proper error format when campaign not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const request = createRequest('nonexistent-campaign');
    const response = await GET(request, {
      params: Promise.resolve({ slug: 'nonexistent-campaign' }),
    });

    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body).toEqual({
      code: 'NOT_FOUND',
      message: 'Campaign tidak ditemukan',
      status: 404,
    });
  });

  it('sets Cache-Control header for ISR support', async () => {
    const mockCampaign = {
      id: 'campaign-2',
      slug: 'test-campaign',
      title: 'Test Campaign',
      description: 'Test description',
      story: '<p>Story</p>',
      coverImage: 'https://example.com/img.jpg',
      targetAmount: 10000000,
      collectedAmount: 5000000,
      category: 'kesehatan',
      status: 'active',
      isUrgent: false,
      deadline: null,
      creatorId: 'user-2',
      createdAt: new Date(),
      updatedAt: new Date(),
      creator: {
        id: 'user-2',
        name: 'Test Creator',
        avatar: 'https://example.com/avatar.jpg',
        isVerified: false,
        verificationType: null,
      },
      _count: {
        donations: 10,
      },
    };

    mockFindUnique.mockResolvedValue(mockCampaign as any);

    const request = createRequest('test-campaign');
    const response = await GET(request, {
      params: Promise.resolve({ slug: 'test-campaign' }),
    });

    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    );
  });

  it('queries prisma with correct include relations', async () => {
    mockFindUnique.mockResolvedValue(null);

    const request = createRequest('some-slug');
    await GET(request, {
      params: Promise.resolve({ slug: 'some-slug' }),
    });

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { slug: 'some-slug' },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            avatar: true,
            isVerified: true,
            verificationType: true,
          },
        },
        _count: {
          select: {
            donations: {
              where: {
                paymentStatus: 'confirmed',
              },
            },
          },
        },
      },
    });
  });

  it('returns 500 on database error', async () => {
    mockFindUnique.mockRejectedValue(new Error('Database connection failed'));

    const request = createRequest('error-campaign');
    const response = await GET(request, {
      params: Promise.resolve({ slug: 'error-campaign' }),
    });

    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Terjadi kesalahan server',
      status: 500,
    });
  });
});


describe('PATCH /api/campaigns/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest('test-campaign', 'PATCH', { title: 'Updated' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'test-campaign' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 if campaign does not exist', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue(null);

    const request = createRequest('nonexistent', 'PATCH', { title: 'Updated' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'nonexistent' }),
    });

    expect(response.status).toBe(404);
  });

  it('allows ADMIN to edit any campaign', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'other-user',
    } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      title: 'Updated Title',
      creator: { id: 'other-user', name: 'Creator', avatar: null, isVerified: true, verificationType: null },
    } as any);

    const request = createRequest('test-campaign', 'PATCH', { title: 'Updated Title' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'test-campaign' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaign.title).toBe('Updated Title');
  });

  it('allows CAMPAIGN_CREATOR who is the owner to edit their campaign', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-user', role: 'CAMPAIGN_CREATOR', name: 'Creator', email: 'creator@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'creator-user',
    } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      title: 'My Updated Campaign',
      creator: { id: 'creator-user', name: 'Creator', avatar: null, isVerified: true, verificationType: null },
    } as any);

    const request = createRequest('my-campaign', 'PATCH', { title: 'My Updated Campaign' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'my-campaign' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaign.title).toBe('My Updated Campaign');
  });

  it('returns 403 for CAMPAIGN_CREATOR who is NOT the owner', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-user', role: 'CAMPAIGN_CREATOR', name: 'Creator', email: 'creator@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'different-user',
    } as any);

    const request = createRequest('other-campaign', 'PATCH', { title: 'Hack' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'other-campaign' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Forbidden');
  });

  it('ignores a status in the body even from an ADMIN -- status moves only through moderation', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'other-user',
    } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      creator: { id: 'other-user', name: 'Creator', avatar: null, isVerified: true, verificationType: null },
    } as any);

    const request = createRequest('bantu-korban-banjir', 'PATCH', { status: 'active' });
    await PATCH(request, {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
  });

  it('ignores a client-supplied lifecycleStatus without a status', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'other-user',
    } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      creator: { id: 'other-user', name: 'Creator', avatar: null, isVerified: true, verificationType: null },
    } as any);

    const request = createRequest('bantu-korban-banjir', 'PATCH', { lifecycleStatus: 'DRAFT' });
    await PATCH(request, {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ lifecycleStatus: expect.anything() }) }));
  });

  it('writes only the fields a Fundraiser may edit, dropping money, status, and ownership fields', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-user', role: 'CAMPAIGN_CREATOR', name: 'Creator', email: 'creator@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'creator-user' } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      creator: { id: 'creator-user', name: 'Creator', avatar: null, isVerified: true, verificationType: null },
    } as any);

    const request = createRequest('bantu-korban-banjir', 'PATCH', {
      title: 'Judul Baru',
      status: 'active',
      collectedAmount: 999999999,
      targetAmount: 1,
      isDemo: true,
      creatorId: 'attacker',
      slug: 'slug-lain',
    });
    await PATCH(request, {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { title: 'Judul Baru' } }));
  });

  it('drops deadline, category, and isUrgent -- those change through a Verification Request or an Admin, not a direct edit', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-user', role: 'CAMPAIGN_CREATOR', name: 'Creator', email: 'creator@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'creator-user' } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      creator: { id: 'creator-user', name: 'Creator', avatar: null, isVerified: true, verificationType: null },
    } as any);

    const request = createRequest('bantu-korban-banjir', 'PATCH', {
      story: '<p>Cerita baru</p>',
      deadline: '2030-01-01T00:00:00.000Z',
      category: 'kesehatan',
      isUrgent: true,
    });
    await PATCH(request, {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { story: '<p>Cerita baru</p>' } }));
  });

  it('returns 400 and writes nothing when an editable field is invalid', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-user', role: 'CAMPAIGN_CREATOR', name: 'Creator', email: 'creator@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'creator-user' } as any);

    const request = createRequest('bantu-korban-banjir', 'PATCH', { title: '', coverImage: 'bukan-url' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(Object.keys(body.fieldErrors).sort()).toEqual(['coverImage', 'title']);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 for DONOR user', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'donor-user', role: 'DONOR', name: 'Donor', email: 'donor@test.com', isVerified: false, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'donor-user',
    } as any);

    const request = createRequest('some-campaign', 'PATCH', { title: 'Hack' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'some-campaign' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Forbidden');
  });
});

describe('DELETE /api/campaigns/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest('test-campaign', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'test-campaign' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 if campaign does not exist', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue(null);

    const request = createRequest('nonexistent', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'nonexistent' }),
    });

    expect(response.status).toBe(404);
  });

  it('allows ADMIN to delete any campaign', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'other-user',
    } as any);
    mockDelete.mockResolvedValue({} as any);

    const request = createRequest('test-campaign', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'test-campaign' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe('Campaign berhasil dihapus');
  });

  it('allows CAMPAIGN_CREATOR who is the owner to delete their campaign', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-user', role: 'CAMPAIGN_CREATOR', name: 'Creator', email: 'creator@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'creator-user',
    } as any);
    mockDelete.mockResolvedValue({} as any);

    const request = createRequest('my-campaign', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'my-campaign' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe('Campaign berhasil dihapus');
  });

  it('returns 403 for CAMPAIGN_CREATOR who is NOT the owner', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-user', role: 'CAMPAIGN_CREATOR', name: 'Creator', email: 'creator@test.com', isVerified: true, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'different-user',
    } as any);

    const request = createRequest('other-campaign', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'other-campaign' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Forbidden');
  });

  it('returns 403 for DONOR user even if they own the campaign', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'donor-user', role: 'DONOR', name: 'Donor', email: 'donor@test.com', isVerified: false, verificationType: null },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'donor-user',
    } as any);

    const request = createRequest('some-campaign', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'some-campaign' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Forbidden');
  });

  it('returns 409 when the campaign has status history', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null, assignments: [] },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'other-user' } as any);
    mockDelete.mockRejectedValue(foreignKeyViolation('CampaignStatusChange_campaignId_fkey'));

    const request = createRequest('test-campaign', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'test-campaign' }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe(
      'Campaign yang sudah memiliki riwayat status tidak dapat dihapus'
    );
  });

  it('returns 409 when the campaign has a Cancellation request on record', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null, assignments: [] },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'other-user' } as any);
    mockDelete.mockRejectedValue(foreignKeyViolation('CancellationRequest_campaignId_fkey'));

    const request = createRequest('test-campaign', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'test-campaign' }),
    });

    expect(response.status).toBe(409);
  });

  it('returns 409 when the campaign has a Flag on record', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null, assignments: [] },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'other-user' } as any);
    mockDelete.mockRejectedValue(foreignKeyViolation('CampaignFlag_campaignId_fkey'));

    const request = createRequest('test-campaign', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'test-campaign' }),
    });

    expect(response.status).toBe(409);
  });

  it.each([
    ['a foreign-key violation from another relation', foreignKeyViolation('Payout_campaignId_fkey')],
    ['an unrelated database error', new Error('connection reset')],
  ])('returns 500 for %s', async (_label, error) => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isVerified: true, verificationType: null, assignments: [] },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'other-user' } as any);
    mockDelete.mockRejectedValue(error);

    const request = createRequest('test-campaign', 'DELETE');
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: 'test-campaign' }),
    });

    expect(response.status).toBe(500);
  });
});
