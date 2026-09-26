import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { GET, PATCH } from './route';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    campaignStatusChange: {
      findFirst: vi.fn(),
    },
    partnerOrganisation: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockFindUnique = vi.mocked(prisma.campaign.findUnique);
const mockUpdate = vi.mocked(prisma.campaign.update);
const mockGetServerSession = vi.mocked(getServerSession);
const mockStatusChangeFindFirst = vi.mocked(prisma.campaignStatusChange.findFirst);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockLockQuery = vi.mocked(prisma.$queryRaw);

function createRequest(slug: string, method = 'GET', body?: unknown) {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(`http://localhost:3000/api/campaigns/${slug}`, init);
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
      kind: 'WAKAF',
      lifecycleStatus: 'ACTIVE',
      isUrgent: false,
      isDemo: false,
      deadline: null,
      creatorId: 'user-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-06-01T00:00:00Z'),
      creator: {
        id: 'user-1',
        name: 'Yayasan Peduli',
        avatar: null,
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
    expect(body.campaign.kind).toBe('WAKAF');
    expect(body.campaign.lifecycleStatus).toBe('ACTIVE');
    expect(body.campaign.isUrgent).toBe(false);
    expect(body.campaign.isDemo).toBe(false);
    expect(body.campaign.creator).toEqual({
      id: 'user-1',
      name: 'Yayasan Peduli',
      avatar: null,
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
      lifecycleStatus: 'ACTIVE',
      isUrgent: false,
      isDemo: true,
      deadline: null,
      creatorId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      creator: { id: 'user-1', name: 'Creator', avatar: null },
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
      lifecycleStatus: 'ACTIVE',
      isUrgent: false,
      deadline: null,
      creatorId: 'user-2',
      createdAt: new Date(),
      updatedAt: new Date(),
      creator: {
        id: 'user-2',
        name: 'Test Creator',
        avatar: 'https://example.com/avatar.jpg',
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
          },
        },
        collectingEntity: {
          select: {
            id: true,
            name: true,
            permits: { select: { kinds: true, validFrom: true, validTo: true } },
            kindAuthorisations: { select: { kind: true, validFrom: true, validTo: true } },
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


describe('GET /api/campaigns/[slug] -- where the Campaign stands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function campaignRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'campaign-1',
      slug: 'bantu-korban-bencana',
      title: 'Bantu Korban Bencana',
      description: 'Deskripsi',
      story: '<p>Cerita</p>',
      coverImage: 'https://example.com/image.jpg',
      targetAmount: 50000000,
      collectedAmount: 1000000,
      category: 'bencana-alam',
      lifecycleStatus: 'ACTIVE',
      isUrgent: false,
      isDemo: false,
      deadline: null,
      creatorId: 'owner-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      creator: { id: 'owner-1', name: 'Pemilik', avatar: null },
      _count: { donations: 3 },
      ...overrides,
    };
  }

  async function getAs(row: Record<string, unknown>) {
    mockFindUnique.mockResolvedValue(row as any);
    const response = await GET(createRequest('bantu-korban-bencana'), {
      params: Promise.resolve({ slug: 'bantu-korban-bencana' }),
    });
    return { response, body: await response.json() };
  }

  describe('the Collecting Entity and whether it lets the Campaign collect (prd-compliance 10)', () => {
    const permit = (validTo: string) => ({
      kinds: ['DONATION'],
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: new Date(validTo),
    });

    it('names the Collecting Entity, without its permits, and no block while its permit is valid', async () => {
      const { body } = await getAs(
        campaignRow({
          kind: 'DONATION',
          collectingEntity: { id: 'yiem', name: 'YIEM', permits: [permit('2026-12-31T00:00:00Z')] },
        })
      );
      expect(body.campaign.collectingEntity).toEqual({ id: 'yiem', name: 'YIEM' });
      expect(body.campaign.donationBlock).toBeNull();
    });

    it('reports NO_VALID_PERMIT once the permit has lapsed, the status staying Active', async () => {
      const { body } = await getAs(
        campaignRow({
          kind: 'DONATION',
          collectingEntity: { id: 'yiem', name: 'YIEM', permits: [permit('2026-09-01T00:00:00Z')] },
        })
      );
      expect(body.campaign.lifecycleStatus).toBe('ACTIVE');
      expect(body.campaign.donationBlock).toBe('NO_VALID_PERMIT');
    });

    it('reports NO_COLLECTING_ENTITY for an Active Campaign that names none', async () => {
      const { body } = await getAs(campaignRow({ kind: 'DONATION', collectingEntity: null }));
      expect(body.campaign.collectingEntity).toBeNull();
      expect(body.campaign.donationBlock).toBe('NO_COLLECTING_ENTITY');
    });
  });

  it('sends lifecycleStatus as its one status field, without the legacy status string', async () => {
    const { body } = await getAs(campaignRow({ lifecycleStatus: 'CANCELLED' }));
    expect(body.campaign.lifecycleStatus).toBe('CANCELLED');
    expect(body.campaign).not.toHaveProperty('status');
  });

  it('reports a Campaign stored Active whose deadline has passed as EXPIRED', async () => {
    const { body } = await getAs(
      campaignRow({ lifecycleStatus: 'ACTIVE', deadline: new Date('2026-09-24T00:00:00Z') })
    );
    expect(body.campaign.lifecycleStatus).toBe('EXPIRED');
  });

  it('keeps a Campaign Active while its deadline is still ahead', async () => {
    const { body } = await getAs(
      campaignRow({ lifecycleStatus: 'ACTIVE', deadline: new Date('2026-09-26T00:00:00Z') })
    );
    expect(body.campaign.lifecycleStatus).toBe('ACTIVE');
  });

  describe('the Suspension reason', () => {
    // The status-change log of campaign-1, oldest first: an earlier
    // Suspension that was lifted, then the current one. A second Campaign's
    // row proves the lookup stays on its own Campaign.
    const log = [
      { campaignId: 'campaign-1', action: 'SUSPENDED', toStatus: 'SUSPENDED', reason: 'Alasan lama yang sudah dicabut', createdAt: new Date('2026-08-01T00:00:00Z') },
      { campaignId: 'campaign-1', action: 'SUSPENSION_LIFTED', toStatus: 'ACTIVE', reason: 'Sudah diperbaiki', createdAt: new Date('2026-08-05T00:00:00Z') },
      { campaignId: 'campaign-1', action: 'SUSPENDED', toStatus: 'SUSPENDED', reason: 'Dokumen penerima manfaat belum lengkap', createdAt: new Date('2026-09-20T00:00:00Z') },
      { campaignId: 'campaign-2', action: 'SUSPENDED', toStatus: 'SUSPENDED', reason: 'Campaign lain', createdAt: new Date('2026-09-21T00:00:00Z') },
      { campaignId: 'campaign-1', action: 'URGENT_CLEARED', toStatus: null, reason: null, createdAt: new Date('2026-09-22T00:00:00Z') },
    ];

    // An in-memory stand-in for findFirst that honours where and orderBy,
    // so the test pins "latest SUSPENDED row of this Campaign" by result,
    // not by the query's shape.
    beforeEach(() => {
      mockStatusChangeFindFirst.mockImplementation((async (args: any) => {
        const where = args?.where ?? {};
        const rows = log
          .filter((row) => Object.entries(where).every(([key, value]) => (row as any)[key] === value))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const row = rows[0];
        if (!row) return null;
        if (!args?.select) return row;
        return Object.fromEntries(Object.keys(args.select).map((key) => [key, (row as any)[key]]));
      }) as any);
    });

    const suspended = () => campaignRow({ lifecycleStatus: 'SUSPENDED' });

    function sessionOf(id: string, assignments: string[] = []) {
      mockGetServerSession.mockResolvedValue({ user: { id, assignments } } as any);
    }

    it('is returned to the owning Fundraiser, from the latest SUSPENDED row', async () => {
      sessionOf('owner-1');
      const { body } = await getAs(suspended());
      expect(body.campaign.lifecycleStatus).toBe('SUSPENDED');
      expect(body.campaign.suspensionReason).toBe('Dokumen penerima manfaat belum lengkap');
    });

    it('is withheld from an anonymous visitor', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const { response, body } = await getAs(suspended());
      expect(body.campaign).not.toHaveProperty('suspensionReason');
      expect(JSON.stringify(body)).not.toContain('Dokumen penerima manfaat');
      expect(response.status).toBe(200);
    });

    it('is withheld from a signed-in user who does not own the Campaign', async () => {
      sessionOf('donor-9');
      const { body } = await getAs(suspended());
      expect(body.campaign).not.toHaveProperty('suspensionReason');
    });

    it('is withheld from an Admin who does not own the Campaign', async () => {
      sessionOf('admin-1', ['ADMIN']);
      const { body } = await getAs(suspended());
      expect(body.campaign).not.toHaveProperty('suspensionReason');
    });

    it('is not returned once the Suspension is lifted, even to the owner', async () => {
      sessionOf('owner-1');
      const { body } = await getAs(campaignRow({ lifecycleStatus: 'ACTIVE' }));
      expect(body.campaign).not.toHaveProperty('suspensionReason');
    });

    it('comes back null for the owner when the latest SUSPENDED row carries no reason', async () => {
      sessionOf('owner-1');
      mockStatusChangeFindFirst.mockResolvedValue({ reason: null } as any);
      const { body } = await getAs(suspended());
      expect(body.campaign.suspensionReason).toBeNull();
    });

    it('comes back null for the owner when no SUSPENDED row is found', async () => {
      sessionOf('owner-1');
      mockStatusChangeFindFirst.mockResolvedValue(null);
      const { body } = await getAs(suspended());
      expect(body.campaign.suspensionReason).toBeNull();
    });

    it('never lets a shared cache hold a Suspended Campaign, for the owner or anyone else', async () => {
      sessionOf('owner-1');
      const owner = await getAs(suspended());
      expect(owner.response.headers.get('Cache-Control')).toBe('private, no-store');

      mockGetServerSession.mockResolvedValue(null);
      const visitor = await getAs(suspended());
      expect(visitor.response.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('does not read the session for a Campaign that is not Suspended', async () => {
      await getAs(campaignRow({ lifecycleStatus: 'ACTIVE' }));
      expect(mockGetServerSession).not.toHaveBeenCalled();
    });
  });
});

describe('GET /api/campaigns/[slug] -- an unapproved Campaign is private', () => {
  // CONTEXT.md, Campaign Status: a Draft, Submitted or Rejected Campaign
  // opens only for its Fundraiser, Verifiers and Admins. Everyone else is
  // told it does not exist, in the same words as a slug that never did.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function row(lifecycleStatus: string) {
    return {
      id: 'campaign-1',
      slug: 'sumur-desa',
      title: 'Sumur untuk Desa',
      description: 'Deskripsi',
      story: '<p>Cerita</p>',
      coverImage: 'https://example.com/a.jpg',
      targetAmount: 10_000_000,
      collectedAmount: 0,
      category: 'lingkungan',
      lifecycleStatus,
      isUrgent: false,
      isDemo: false,
      deadline: null,
      creatorId: 'owner-1',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
      creator: { id: 'owner-1', name: 'Pemilik', avatar: null },
      _count: { donations: 0 },
    };
  }

  const viewers = {
    anonymous: null,
    'another signed-in user': { user: { id: 'donor-9', assignments: [] } },
    'the Fundraiser': { user: { id: 'owner-1', assignments: [] } },
    'a Verifier': { user: { id: 'verifier-1', assignments: ['VERIFIER'] } },
    'an Admin': { user: { id: 'admin-1', assignments: ['ADMIN'] } },
    // Viewing is not acting: owning the Campaign bars acting on it as its
    // Verifier, not looking at it.
    'a Verifier who owns it': { user: { id: 'owner-1', assignments: ['VERIFIER'] } },
  } as const;

  const privileged = ['the Fundraiser', 'a Verifier', 'an Admin', 'a Verifier who owns it'] as const;
  const outsiders = ['anonymous', 'another signed-in user'] as const;

  async function getAs(viewer: keyof typeof viewers, lifecycleStatus: string) {
    mockGetServerSession.mockResolvedValue(viewers[viewer] as any);
    mockFindUnique.mockResolvedValue(row(lifecycleStatus) as any);
    const response = await GET(createRequest('sumur-desa'), {
      params: Promise.resolve({ slug: 'sumur-desa' }),
    });
    return { response, body: await response.json() };
  }

  describe.each(['DRAFT', 'SUBMITTED', 'REJECTED'])('while %s', (status) => {
    it.each(outsiders)('answers 404 to %s, exactly as for a missing slug', async (viewer) => {
      const { response, body } = await getAs(viewer, status);

      expect(response.status).toBe(404);
      expect(body).toEqual({ code: 'NOT_FOUND', message: 'Campaign tidak ditemukan', status: 404 });
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it.each(privileged)('opens for %s, with its status, never shared-cached', async (viewer) => {
      const { response, body } = await getAs(viewer, status);

      expect(response.status).toBe(200);
      expect(body.campaign.lifecycleStatus).toBe(status);
      expect(body.campaign.title).toBe('Sumur untuk Desa');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });
  });

  describe.each(['ACTIVE', 'CANCELLED', 'COMPLETED'])('once approved (%s)', (status) => {
    it.each(outsiders)('opens for %s as today, publicly cached', async (viewer) => {
      const { response, body } = await getAs(viewer, status);

      expect(response.status).toBe(200);
      expect(body.campaign.lifecycleStatus).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe(
        'public, s-maxage=60, stale-while-revalidate=300'
      );
    });
  });

  it('answers 404 to an outsider for a status it does not know (deny by default)', async () => {
    const { response } = await getAs('anonymous', 'SOMETHING_NEW');
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/campaigns/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // An interactive transaction runs its callback on the same client.
    mockTransaction.mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as any);
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
      user: { id: 'user-1', name: 'Admin', email: 'admin@test.com' },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue(null);

    const request = createRequest('nonexistent', 'PATCH', { title: 'Updated' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'nonexistent' }),
    });

    expect(response.status).toBe(404);
  });

  it('allows an Admin (the ADMIN assignment) to edit any campaign', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', name: 'Admin', email: 'admin@test.com', assignments: ['ADMIN'] },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'other-user', lifecycleStatus: 'ACTIVE', deadline: null,
    } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      title: 'Updated Title',
      creator: { id: 'other-user', name: 'Creator', avatar: null },
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
      user: { id: 'creator-user', name: 'Creator', email: 'creator@test.com' },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'creator-user', lifecycleStatus: 'ACTIVE', deadline: null,
    } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      title: 'My Updated Campaign',
      creator: { id: 'creator-user', name: 'Creator', avatar: null },
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
      user: { id: 'creator-user', name: 'Creator', email: 'creator@test.com' },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'different-user', lifecycleStatus: 'ACTIVE', deadline: null,
    } as any);

    const request = createRequest('other-campaign', 'PATCH', { title: 'Hack' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'other-campaign' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({
      error: 'Hanya Fundraiser Campaign ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
  });

  it('ignores a status in the body even from an ADMIN -- status moves only through moderation', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', name: 'Admin', email: 'admin@test.com', assignments: ['ADMIN'] },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'other-user', lifecycleStatus: 'ACTIVE', deadline: null,
    } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      creator: { id: 'other-user', name: 'Creator', avatar: null },
    } as any);

    const request = createRequest('bantu-korban-banjir', 'PATCH', { status: 'active' });
    await PATCH(request, {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
  });

  it('ignores a client-supplied lifecycleStatus without a status', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-user', name: 'Admin', email: 'admin@test.com', assignments: ['ADMIN'] },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'other-user', lifecycleStatus: 'ACTIVE', deadline: null,
    } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      creator: { id: 'other-user', name: 'Creator', avatar: null },
    } as any);

    const request = createRequest('bantu-korban-banjir', 'PATCH', { lifecycleStatus: 'DRAFT' });
    await PATCH(request, {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ lifecycleStatus: expect.anything() }) }));
  });

  it('writes only the fields a Fundraiser may edit, dropping money, status, and ownership fields', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-user', name: 'Creator', email: 'creator@test.com' },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'creator-user', lifecycleStatus: 'ACTIVE', deadline: null } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      creator: { id: 'creator-user', name: 'Creator', avatar: null },
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
    // Nor is the legacy status string sent back (legacy-status-contract 02).
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ omit: { status: true } }));
  });

  it('drops category and isUrgent -- those change through a Verification Request or an Admin, not a direct edit', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-user', name: 'Creator', email: 'creator@test.com' },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'creator-user', lifecycleStatus: 'ACTIVE', deadline: null } as any);
    mockUpdate.mockResolvedValue({
      id: 'campaign-1',
      creator: { id: 'creator-user', name: 'Creator', avatar: null },
    } as any);

    const request = createRequest('bantu-korban-banjir', 'PATCH', {
      story: '<p>Cerita baru</p>',
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
      user: { id: 'creator-user', name: 'Creator', email: 'creator@test.com' },
      expires: '2099-01-01',
    });
    mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'creator-user', lifecycleStatus: 'ACTIVE', deadline: null } as any);

    const request = createRequest('bantu-korban-banjir', 'PATCH', { title: '', coverImage: 'bukan-url' });
    const response = await PATCH(request, {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(Object.keys(body.fieldErrors).sort()).toEqual(['coverImage', 'title']);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  describe('Admin power comes from the ADMIN assignment (ADR 0005)', () => {
    function sessionAs(user: { id: string; assignments: string[] }) {
      mockGetServerSession.mockResolvedValue({ user, expires: '2099-01-01' } as any);
    }
    function patchCampaignOwnedBy(creatorId: string) {
      mockFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId, lifecycleStatus: 'ACTIVE', deadline: null } as any);
      mockUpdate.mockResolvedValue({ id: 'campaign-1', title: 'Baru' } as any);
      return PATCH(createRequest('test-campaign', 'PATCH', { title: 'Baru' }), {
        params: Promise.resolve({ slug: 'test-campaign' }),
      });
    }

    it('lets someone holding the ADMIN assignment edit a Campaign they do not own', async () => {
      sessionAs({ id: 'ops-1', assignments: ['ADMIN'] });

      const response = await patchCampaignOwnedBy('other-user');

      expect(response.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('refuses someone without the ADMIN assignment on a Campaign they do not own', async () => {
      sessionAs({ id: 'legacy-admin', assignments: [] });

      const response = await patchCampaignOwnedBy('other-user');

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'Hanya Fundraiser Campaign ini yang dapat melakukan tindakan ini.',
        code: 'NOT_AUTHORIZED',
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('lets an Admin edit their own Campaign, as its Fundraiser', async () => {
      sessionAs({ id: 'owner-admin', assignments: ['ADMIN'] });

      const response = await patchCampaignOwnedBy('owner-admin');

      expect(response.status).toBe(200);
    });

    it('lets the owner edit their Campaign whatever their Role, with no assignment', async () => {
      sessionAs({ id: 'owner-1', assignments: [] });

      const response = await patchCampaignOwnedBy('owner-1');

      expect(response.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('does not let the VERIFIER assignment stand in for ADMIN', async () => {
      sessionAs({ id: 'verifier-1', assignments: ['VERIFIER'] });

      const response = await patchCampaignOwnedBy('other-user');

      expect(response.status).toBe(403);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});

describe('PATCH /api/campaigns/[slug] -- content edits follow the Campaign status', () => {
  const NOW = new Date('2026-09-26T12:00:00Z');
  const owner = { id: 'owner-1', name: 'Pemilik', email: 'owner@test.com' };

  // The one stored Campaign row; both the slug lookup and the read under
  // the lock see it as it stands at the time of the call.
  let row: { id: string; slug: string; creatorId: string; lifecycleStatus: string; deadline: Date | null; kind: string };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mockTransaction.mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as any);
    mockLockQuery.mockResolvedValue([] as any);
    mockFindUnique.mockImplementation((async () => ({ ...row })) as any);
    mockUpdate.mockImplementation((async (args: any) => ({ ...row, ...args.data })) as any);
    mockGetServerSession.mockResolvedValue({ user: owner, expires: '2099-01-01' } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function storedAs(lifecycleStatus: string, deadline: Date | null = null, kind = 'DONATION') {
    row = { id: 'campaign-1', slug: 'bantu-korban-banjir', creatorId: owner.id, lifecycleStatus, deadline, kind };
  }

  function editTitle() {
    return PATCH(createRequest('bantu-korban-banjir', 'PATCH', { title: 'Judul Baru' }), {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });
  }

  it.each(['DRAFT', 'REJECTED', 'ACTIVE'])('lets the Fundraiser edit the content of a %s Campaign', async (status) => {
    storedAs(status);

    const response = await editTitle();

    expect(response.status).toBe(200);
    expect((await response.json()).campaign.title).toBe('Judul Baru');
  });

  it('lets the Fundraiser edit an Active Campaign whose deadline is still ahead', async () => {
    storedAs('ACTIVE', new Date('2026-10-01T00:00:00Z'));

    const response = await editTitle();

    expect(response.status).toBe(200);
  });

  it('refuses while Submitted, so the Verifier checks a fixed version', async () => {
    storedAs('SUBMITTED');

    const response = await editTitle();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'CAMPAIGN_NOT_EDITABLE',
      error: 'Konten Campaign tidak dapat diubah saat berstatus Submitted.',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['SUSPENDED', 'Suspended'],
    ['CANCELLED', 'Cancelled'],
    ['COMPLETED', 'Completed'],
    ['EXPIRED', 'Expired'],
  ])('refuses in the final status %s', async (status, label) => {
    storedAs(status);

    const response = await editTitle();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'CAMPAIGN_NOT_EDITABLE',
      error: `Konten Campaign tidak dapat diubah saat berstatus ${label}.`,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses an Active Campaign past its deadline, which is effectively Expired', async () => {
    storedAs('ACTIVE', new Date('2026-09-25T00:00:00Z'));

    const response = await editTitle();

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('Konten Campaign tidak dapat diubah saat berstatus Expired.');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses an Admin on a Submitted Campaign they do not own too', async () => {
    storedAs('SUBMITTED');
    mockGetServerSession.mockResolvedValue({
      user: { id: 'admin-1', assignments: ['ADMIN'] },
      expires: '2099-01-01',
    } as any);

    const response = await editTitle();

    expect(response.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 the same way when the Campaign is gone by the time the lock is taken', async () => {
    storedAs('DRAFT');
    mockFindUnique
      .mockImplementationOnce((async () => ({ ...row })) as any)
      .mockImplementationOnce((async () => null) as any);

    const response = await editTitle();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Campaign tidak ditemukan' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('judges a submit committed before this edit took the lock, and writes nothing', async () => {
    storedAs('DRAFT');
    // The Fundraiser submits from another tab between our first read and
    // our row lock; the lock is granted only once that submit commits.
    mockLockQuery.mockImplementation((async () => {
      row = { ...row, lifecycleStatus: 'SUBMITTED' };
      return [];
    }) as any);

    const response = await editTitle();

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('CAMPAIGN_NOT_EDITABLE');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/campaigns/[slug] -- Kind is fixed once the Campaign leaves Draft', () => {
  const NOW = new Date('2026-09-26T12:00:00Z');
  const DEADLINE = new Date('2026-12-31T00:00:00Z');
  const owner = { id: 'owner-1', name: 'Pemilik', email: 'owner@test.com' };
  let row: { id: string; slug: string; creatorId: string; lifecycleStatus: string; deadline: Date | null; kind: string };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mockTransaction.mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    mockLockQuery.mockResolvedValue([] as never);
    mockFindUnique.mockImplementation((async () => ({ ...row })) as never);
    mockUpdate.mockImplementation((async (args: { data: object }) => ({ ...row, ...args.data })) as never);
    mockGetServerSession.mockResolvedValue({ user: owner, expires: '2099-01-01' } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function storedAs(lifecycleStatus: string, kind: string, deadline: Date | null = DEADLINE) {
    row = { id: 'campaign-1', slug: 'bantu-korban-banjir', creatorId: owner.id, lifecycleStatus, deadline, kind };
  }

  function edit(body: Record<string, unknown>) {
    return PATCH(createRequest('bantu-korban-banjir', 'PATCH', body), {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });
  }

  it("changes a Draft's Kind", async () => {
    storedAs('DRAFT', 'DONATION');

    const response = await edit({ kind: 'ZAKAT' });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { kind: 'ZAKAT' } }));
  });

  it.each(['REJECTED', 'ACTIVE'])('refuses to change the Kind of a %s Campaign with 409 KIND_IMMUTABLE', async (status) => {
    storedAs(status, 'DONATION');

    const response = await edit({ kind: 'ZAKAT', title: 'Judul Baru' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'KIND_IMMUTABLE',
      error: 'Kind Campaign tidak dapat diubah setelah Campaign meninggalkan Draft.',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('accepts the Kind it already has on an Active Campaign, so a form resending every field still saves', async () => {
    storedAs('ACTIVE', 'ZAKAT');

    const response = await edit({ kind: 'ZAKAT', title: 'Judul Baru' });

    expect(response.status).toBe(200);
  });

  it('refuses to turn a wakaf Draft without a deadline into a Kind that needs one', async () => {
    storedAs('DRAFT', 'WAKAF', null);

    const response = await edit({ kind: 'DONATION' });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('DEADLINE_REQUIRED');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('turns a Draft into wakaf even without a deadline', async () => {
    storedAs('DRAFT', 'DONATION', null);

    const response = await edit({ kind: 'WAKAF' });

    expect(response.status).toBe(200);
  });

  it('answers 400 to a Kind the platform does not know', async () => {
    storedAs('DRAFT', 'DONATION');

    const response = await edit({ kind: 'INFAQ' });

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('turns a wakaf Draft without a deadline into a donation when the same edit sets one', async () => {
    storedAs('DRAFT', 'WAKAF', null);

    const response = await edit({ kind: 'DONATION', deadline: '2026-12-31T00:00:00.000Z' });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { kind: 'DONATION', deadline: DEADLINE } }),
    );
  });
});

describe('PATCH /api/campaigns/[slug] -- the deadline is set before a Verifier sees the Campaign', () => {
  const NOW = new Date('2026-09-26T12:00:00Z');
  const DEADLINE = new Date('2026-12-31T00:00:00Z');
  const owner = { id: 'owner-1', name: 'Pemilik', email: 'owner@test.com' };
  let row: { id: string; slug: string; creatorId: string; lifecycleStatus: string; deadline: Date | null; kind: string };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mockTransaction.mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    mockLockQuery.mockResolvedValue([] as never);
    mockFindUnique.mockImplementation((async () => ({ ...row })) as never);
    mockUpdate.mockImplementation((async (args: { data: object }) => ({ ...row, ...args.data })) as never);
    mockGetServerSession.mockResolvedValue({ user: owner, expires: '2099-01-01' } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function storedAs(lifecycleStatus: string, kind: string, deadline: Date | null) {
    row = { id: 'campaign-1', slug: 'bantu-korban-banjir', creatorId: owner.id, lifecycleStatus, deadline, kind };
  }

  function edit(body: Record<string, unknown>) {
    return PATCH(createRequest('bantu-korban-banjir', 'PATCH', body), {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });
  }

  it.each(['DRAFT', 'REJECTED'])('sets the deadline of a %s donation that has none, so it can be submitted', async (status) => {
    storedAs(status, 'DONATION', null);

    const response = await edit({ deadline: '2026-12-31T00:00:00.000Z' });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { deadline: DEADLINE } }));
  });

  it('refuses to move the deadline of an Active Campaign, which takes a new Verification Request', async () => {
    storedAs('ACTIVE', 'DONATION', DEADLINE);

    const response = await edit({ deadline: '2027-06-30T00:00:00.000Z' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'DEADLINE_NOT_EDITABLE',
      error: 'Tenggat Campaign hanya dapat diubah saat berstatus Draft atau Rejected.',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('accepts the deadline an Active Campaign already has', async () => {
    storedAs('ACTIVE', 'DONATION', DEADLINE);

    const response = await edit({ deadline: '2026-12-31T00:00:00.000Z', title: 'Judul Baru' });

    expect(response.status).toBe(200);
  });

  it("refuses to clear a donation Draft's deadline", async () => {
    storedAs('DRAFT', 'DONATION', DEADLINE);

    const response = await edit({ deadline: null });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('DEADLINE_REQUIRED');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("clears a wakaf Draft's deadline", async () => {
    storedAs('DRAFT', 'WAKAF', DEADLINE);

    const response = await edit({ deadline: null });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { deadline: null } }));
  });
});

describe('PATCH /api/campaigns/[slug] -- the Collecting Entity is chosen before a Verifier sees the Campaign', () => {
  const owner = { id: 'owner-1', name: 'Pemilik', email: 'owner@test.com' };
  const ORGANISATIONS = [
    { id: 'sponsor', name: 'Yayasan Penaung', fundraiserId: 'x', acceptsIndividualCampaigns: true },
    { id: 'other', name: 'Yayasan Lain', fundraiserId: 'y', acceptsIndividualCampaigns: true },
    { id: 'closed', name: 'Yayasan Tertutup', fundraiserId: 'z', acceptsIndividualCampaigns: false },
  ];
  let row: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    mockLockQuery.mockResolvedValue([] as never);
    mockFindUnique.mockImplementation((async () => ({ ...row })) as never);
    mockUpdate.mockImplementation((async (args: { data: object }) => ({ ...row, ...args.data })) as never);
    mockGetServerSession.mockResolvedValue({ user: owner, expires: '2099-01-01' } as never);
    vi.mocked(prisma.partnerOrganisation.findUnique).mockImplementation((async ({ where }: { where: { id?: string; fundraiserId?: string } }) =>
      ORGANISATIONS.find((o) => (where.id !== undefined ? o.id === where.id : o.fundraiserId === where.fundraiserId)) ?? null) as never);
  });

  function storedAs(lifecycleStatus: string, collectingEntityId: string | null = 'sponsor') {
    row = {
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      creatorId: owner.id,
      lifecycleStatus,
      deadline: new Date('2099-12-31T00:00:00Z'),
      kind: 'DONATION',
      collectingEntityId,
    };
  }

  function edit(body: Record<string, unknown>) {
    return PATCH(createRequest('bantu-korban-banjir', 'PATCH', body), {
      params: Promise.resolve({ slug: 'bantu-korban-banjir' }),
    });
  }

  it.each(['DRAFT', 'REJECTED'])('changes the sponsoring organisation of a %s Campaign', async (status) => {
    storedAs(status);

    const response = await edit({ collectingEntityId: 'other' });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { collectingEntityId: 'other' } }));
  });

  it.each(['SUBMITTED', 'ACTIVE'])('refuses to change it on a %s Campaign', async (status) => {
    storedAs(status);

    const response = await edit({ collectingEntityId: 'other' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(status === 'SUBMITTED' ? 'CAMPAIGN_NOT_EDITABLE' : 'COLLECTING_ENTITY_NOT_EDITABLE');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('accepts the one it already has on an Active Campaign', async () => {
    storedAs('ACTIVE');

    const response = await edit({ collectingEntityId: 'sponsor', title: 'Judul Baru' });

    expect(response.status).toBe(200);
  });

  it('refuses an organisation that does not accept individual Campaigns, with 422', async () => {
    storedAs('DRAFT');

    const response = await edit({ collectingEntityId: 'closed' });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('COLLECTING_ENTITY_NOT_ELIGIBLE');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/campaigns/[slug]', () => {
  it('does not exist: a Campaign stops only through its lifecycle, never by deletion (ADR 0016)', () => {
    expect(route).not.toHaveProperty('DELETE');
  });
});
