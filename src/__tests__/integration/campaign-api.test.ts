import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    campaignUpdate: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    donation: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    payout: {
      findMany: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

// Import route handlers
import { GET as getCampaigns, POST as postCampaign } from '@/app/api/campaigns/route';
import { GET as getCampaignDetail } from '@/app/api/campaigns/[slug]/route';
import { GET as getCampaignUpdates } from '@/app/api/campaigns/[slug]/updates/route';
import { GET as getCampaignDonations } from '@/app/api/campaigns/[slug]/donations/route';
import { GET as getCampaignDisbursements } from '@/app/api/campaigns/[slug]/disbursements/route';

// Typed mocks
const mockFindMany = vi.mocked(prisma.campaign.findMany);
const mockFindUnique = vi.mocked(prisma.campaign.findUnique);
const mockCount = vi.mocked(prisma.campaign.count);
const mockCreate = vi.mocked(prisma.campaign.create);
const mockGetServerSession = vi.mocked(getServerSession);
const mockUpdateFindMany = vi.mocked(prisma.campaignUpdate.findMany);
const mockUpdateCount = vi.mocked(prisma.campaignUpdate.count);
const mockDonationFindMany = vi.mocked(prisma.donation.findMany);
const mockDonationCount = vi.mocked(prisma.donation.count);
const mockPayoutFindMany = vi.mocked(prisma.payout.findMany);

// Helpers
function createGetRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Test data factories
function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'campaign-1',
    slug: 'bantuan-banjir-abc123',
    title: 'Bantuan untuk Korban Banjir',
    description: 'Campaign untuk membantu korban banjir',
    story: '<p>Cerita lengkap</p>',
    coverImage: 'https://example.com/image.jpg',
    targetAmount: 50000000,
    collectedAmount: 25000000,
    category: 'bencana-alam',
    status: 'active',
    isUrgent: false,
    deadline: new Date('2025-12-31'),
    creatorId: 'user-1',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-10'),
    creator: { name: 'Creator', isVerified: true, verificationType: 'ktp' },
    ...overrides,
  };
}

function makeVerifiedSession() {
  return {
    user: {
      id: 'user-1',
      name: 'Creator',
      email: 'creator@example.com',
      role: 'CAMPAIGN_CREATOR',
      isVerified: true,
      verificationType: 'ktp',
    },
    expires: '2099-01-01',
  };
}

function makeUnverifiedSession() {
  return {
    user: {
      id: 'user-2',
      name: 'Unverified User',
      email: 'unverified@example.com',
      role: 'DONOR',
      isVerified: false,
      verificationType: null,
    },
    expires: '2099-01-01',
  };
}

describe('Campaign API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/campaigns - Filtering', () => {
    it('filters by category and returns only matching campaigns', async () => {
      const healthCampaigns = [
        makeCampaign({ id: '1', category: 'kesehatan', title: 'Health Campaign 1' }),
        makeCampaign({ id: '2', category: 'kesehatan', title: 'Health Campaign 2' }),
      ];

      mockFindMany.mockResolvedValue(healthCampaigns as never);
      mockCount.mockResolvedValue(2);

      const request = createGetRequest('/api/campaigns?category=kesehatan');
      const response = await getCampaigns(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.campaigns).toHaveLength(2);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'kesehatan', status: 'active' }),
        })
      );
    });

    it('filters by search keyword across title and description', async () => {
      const matchedCampaigns = [
        makeCampaign({ id: '1', title: 'Bantu anak yatim' }),
      ];

      mockFindMany.mockResolvedValue(matchedCampaigns as never);
      mockCount.mockResolvedValue(1);

      const request = createGetRequest('/api/campaigns?search=anak');
      const response = await getCampaigns(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.campaigns).toHaveLength(1);
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

    it('filters by urgent=true to show only urgent campaigns', async () => {
      const urgentCampaigns = [
        makeCampaign({ id: '1', isUrgent: true, title: 'Urgent Campaign' }),
      ];

      mockFindMany.mockResolvedValue(urgentCampaigns as never);
      mockCount.mockResolvedValue(1);

      const request = createGetRequest('/api/campaigns?urgent=true');
      const response = await getCampaigns(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.campaigns).toHaveLength(1);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isUrgent: true }),
        })
      );
    });

    it('ignores a ?status= query, so Submitted Campaigns cannot be listed', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const request = createGetRequest('/api/campaigns?status=pending');
      const response = await getCampaigns(request);

      expect(response.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        })
      );
    });

    it('combines multiple filters (category + urgent + search)', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const request = createGetRequest('/api/campaigns?category=kesehatan&urgent=true&search=anak');
      await getCampaigns(request);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: 'kesehatan',
            isUrgent: true,
            status: 'active',
            OR: [
              { title: { contains: 'anak', mode: 'insensitive' } },
              { description: { contains: 'anak', mode: 'insensitive' } },
            ],
          }),
        })
      );
    });
  });

  describe('GET /api/campaigns - Pagination', () => {
    it('paginates correctly with page and limit params', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(50);

      const request = createGetRequest('/api/campaigns?page=3&limit=10');
      const response = await getCampaigns(request);
      const data = await response.json();

      expect(data.page).toBe(3);
      expect(data.limit).toBe(10);
      expect(data.totalPages).toBe(5);
      expect(data.total).toBe(50);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
    });

    it('defaults to page 1 and limit 12', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(24);

      const request = createGetRequest('/api/campaigns');
      const response = await getCampaigns(request);
      const data = await response.json();

      expect(data.page).toBe(1);
      expect(data.limit).toBe(12);
      expect(data.totalPages).toBe(2);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 12 })
      );
    });

    it('clamps limit to maximum 50', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const request = createGetRequest('/api/campaigns?limit=200');
      const response = await getCampaigns(request);
      const data = await response.json();

      expect(data.limit).toBe(50);
    });

    it('clamps page to minimum 1 when given 0 or negative', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const request = createGetRequest('/api/campaigns?page=-1');
      const response = await getCampaigns(request);
      const data = await response.json();

      expect(data.page).toBe(1);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 })
      );
    });
  });

  describe('GET /api/campaigns/[slug] - Campaign Detail', () => {
    it('returns full campaign detail with donation count', async () => {
      const campaignWithCount = {
        ...makeCampaign(),
        creator: {
          id: 'user-1',
          name: 'Creator',
          avatar: 'https://example.com/avatar.jpg',
          isVerified: true,
          verificationType: 'ktp',
        },
        _count: { donations: 15 },
      };

      mockFindUnique.mockResolvedValue(campaignWithCount as never);

      const request = createGetRequest('/api/campaigns/bantuan-banjir-abc123');
      const response = await getCampaignDetail(request, {
        params: Promise.resolve({ slug: 'bantuan-banjir-abc123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.campaign).toBeDefined();
      expect(data.campaign.slug).toBe('bantuan-banjir-abc123');
      expect(data.campaign.title).toBe('Bantuan untuk Korban Banjir');
      expect(data.campaign.donationCount).toBe(15);
      expect(data.campaign.creator.name).toBe('Creator');
      expect(data.campaign.creator.isVerified).toBe(true);
    });

    it('returns 404 for non-existent campaign slug', async () => {
      mockFindUnique.mockResolvedValue(null);

      const request = createGetRequest('/api/campaigns/non-existent-slug');
      const response = await getCampaignDetail(request, {
        params: Promise.resolve({ slug: 'non-existent-slug' }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.code).toBe('NOT_FOUND');
      expect(data.message).toBe('Campaign tidak ditemukan');
    });

    it('includes all required campaign fields in response', async () => {
      const campaignWithCount = {
        ...makeCampaign(),
        creator: {
          id: 'user-1',
          name: 'Creator',
          avatar: null,
          isVerified: true,
          verificationType: 'ktp',
        },
        _count: { donations: 5 },
      };

      mockFindUnique.mockResolvedValue(campaignWithCount as never);

      const request = createGetRequest('/api/campaigns/bantuan-banjir-abc123');
      const response = await getCampaignDetail(request, {
        params: Promise.resolve({ slug: 'bantuan-banjir-abc123' }),
      });
      const data = await response.json();

      const campaign = data.campaign;
      expect(campaign).toHaveProperty('id');
      expect(campaign).toHaveProperty('slug');
      expect(campaign).toHaveProperty('title');
      expect(campaign).toHaveProperty('description');
      expect(campaign).toHaveProperty('story');
      expect(campaign).toHaveProperty('coverImage');
      expect(campaign).toHaveProperty('targetAmount');
      expect(campaign).toHaveProperty('collectedAmount');
      expect(campaign).toHaveProperty('category');
      expect(campaign).toHaveProperty('status');
      expect(campaign).toHaveProperty('isUrgent');
      expect(campaign).toHaveProperty('deadline');
      expect(campaign).toHaveProperty('creator');
      expect(campaign).toHaveProperty('donationCount');
    });
  });

  describe('POST /api/campaigns - Authentication & Verification', () => {
    const validBody = {
      title: 'Bantuan untuk Korban Banjir',
      description: 'Campaign untuk membantu korban banjir',
      story: '<p>Cerita lengkap tentang banjir</p>',
      coverImage: 'https://example.com/image.jpg',
      targetAmount: 50000000,
      category: 'bencana-alam',
    };

    it('requires authentication - returns 401 without session', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createPostRequest('/api/campaigns', validBody);
      const response = await postCampaign(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('requires CAMPAIGN_CREATOR role - returns 403 for DONOR', async () => {
      mockGetServerSession.mockResolvedValue(makeUnverifiedSession() as never);

      const request = createPostRequest('/api/campaigns', validBody);
      const response = await postCampaign(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden');
    });

    it('validates all required fields', async () => {
      mockGetServerSession.mockResolvedValue(makeVerifiedSession() as never);

      const emptyBody = {
        title: '',
        description: '',
        story: '',
        coverImage: 'invalid-url',
        targetAmount: -1,
        category: '',
      };

      const request = createPostRequest('/api/campaigns', emptyBody);
      const response = await postCampaign(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Validasi gagal');
      expect(data.fieldErrors).toBeDefined();
      expect(data.fieldErrors.title).toBeDefined();
      expect(data.fieldErrors.description).toBeDefined();
      expect(data.fieldErrors.story).toBeDefined();
      expect(data.fieldErrors.coverImage).toBeDefined();
      expect(data.fieldErrors.targetAmount).toBeDefined();
      expect(data.fieldErrors.category).toBeDefined();
    });

    it('creates campaign with generated slug on success', async () => {
      mockGetServerSession.mockResolvedValue(makeVerifiedSession() as never);

      const createdCampaign = {
        id: 'campaign-new',
        slug: 'bantuan-untuk-korban-banjir-x9y2z1',
        ...validBody,
        collectedAmount: 0,
        status: 'active',
        isUrgent: false,
        deadline: null,
        creatorId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        creator: { name: 'Creator', isVerified: true, verificationType: 'ktp' },
      };

      mockCreate.mockResolvedValue(createdCampaign as never);

      const request = createPostRequest('/api/campaigns', validBody);
      const response = await postCampaign(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.id).toBe('campaign-new');
      expect(data.slug).toMatch(/^bantuan-untuk-korban-banjir-[a-z0-9]+$/);

      // Verify create was called with generated slug
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: validBody.title,
            creatorId: 'user-1',
            slug: expect.stringMatching(/^bantuan-untuk-korban-banjir-[a-z0-9]+$/),
          }),
        })
      );
    });

    it('rejects title exceeding 200 characters', async () => {
      mockGetServerSession.mockResolvedValue(makeVerifiedSession() as never);

      const bodyWithLongTitle = {
        ...validBody,
        title: 'a'.repeat(201),
      };

      const request = createPostRequest('/api/campaigns', bodyWithLongTitle);
      const response = await postCampaign(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.fieldErrors.title).toBeDefined();
    });

    it('accepts targetAmount of exactly 1 (positive)', async () => {
      mockGetServerSession.mockResolvedValue(makeVerifiedSession() as never);
      mockCreate.mockResolvedValue({ id: 'c1' } as never);

      const bodyWithMinTarget = { ...validBody, targetAmount: 1 };

      const request = createPostRequest('/api/campaigns', bodyWithMinTarget);
      const response = await postCampaign(request);

      expect(response.status).toBe(201);
    });

    it('rejects targetAmount of 0', async () => {
      mockGetServerSession.mockResolvedValue(makeVerifiedSession() as never);

      const bodyWithZeroTarget = { ...validBody, targetAmount: 0 };

      const request = createPostRequest('/api/campaigns', bodyWithZeroTarget);
      const response = await postCampaign(request);

      expect(response.status).toBe(400);
    });
  });

  describe('Campaign Sub-Resources', () => {
    describe('GET /api/campaigns/[slug]/updates', () => {
      it('returns paginated campaign updates', async () => {
        mockFindUnique.mockResolvedValue({ id: 'campaign-1' } as never);

        const updates = [
          { id: 'u1', title: 'Update 1', content: '<p>Content 1</p>', images: [], createdAt: new Date('2025-01-10') },
          { id: 'u2', title: 'Update 2', content: '<p>Content 2</p>', images: ['https://img.com/1.jpg'], createdAt: new Date('2025-01-05') },
        ];

        mockUpdateFindMany.mockResolvedValue(updates as never);
        mockUpdateCount.mockResolvedValue(2);

        const request = createGetRequest('/api/campaigns/bantuan-banjir-abc123/updates?page=1&limit=10');
        const response = await getCampaignUpdates(request, {
          params: Promise.resolve({ slug: 'bantuan-banjir-abc123' }),
        });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.updates).toHaveLength(2);
        expect(data.total).toBe(2);
        expect(data.page).toBe(1);
        expect(data.totalPages).toBe(1);
      });

      it('returns 404 if campaign slug does not exist', async () => {
        mockFindUnique.mockResolvedValue(null);

        const request = createGetRequest('/api/campaigns/non-existent/updates');
        const response = await getCampaignUpdates(request, {
          params: Promise.resolve({ slug: 'non-existent' }),
        });
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.code).toBe('NOT_FOUND');
      });
    });

    describe('GET /api/campaigns/[slug]/donations', () => {
      it('returns paginated confirmed donations with donor names', async () => {
        mockFindUnique.mockResolvedValue({ id: 'campaign-1' } as never);

        const donations = [
          { id: 'd1', amount: 50000, isAnonymous: false, message: 'Semoga cepat sembuh', createdAt: new Date(), donor: { name: 'John' } },
          { id: 'd2', amount: 100000, isAnonymous: true, message: null, createdAt: new Date(), donor: { name: 'Jane' } },
        ];

        mockDonationFindMany.mockResolvedValue(donations as never);
        mockDonationCount.mockResolvedValue(2);

        const request = createGetRequest('/api/campaigns/bantuan-banjir-abc123/donations');
        const response = await getCampaignDonations(request, {
          params: Promise.resolve({ slug: 'bantuan-banjir-abc123' }),
        });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.donations).toHaveLength(2);
        expect(data.donations[0].donorName).toBe('John');
        expect(data.donations[1].donorName).toBe('Anonim'); // Anonymous
        expect(data.total).toBe(2);
      });

      it('returns 404 if campaign slug does not exist', async () => {
        mockFindUnique.mockResolvedValue(null);

        const request = createGetRequest('/api/campaigns/non-existent/donations');
        const response = await getCampaignDonations(request, {
          params: Promise.resolve({ slug: 'non-existent' }),
        });
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.code).toBe('NOT_FOUND');
      });
    });

    describe('GET /api/campaigns/[slug]/disbursements', () => {
      it('returns all completed payout records for the campaign', async () => {
        mockFindUnique.mockResolvedValue({ id: 'campaign-1' } as never);

        const payouts = [
          { id: 'payout1', amount: 10000000, description: 'Pembelian bahan bangunan', proofImage: 'https://proof.com/1.jpg', createdAt: new Date() },
          { id: 'payout2', amount: 5000000, description: 'Biaya transportasi', proofImage: null, createdAt: new Date() },
        ];

        mockPayoutFindMany.mockResolvedValue(payouts as never);

        const request = createGetRequest('/api/campaigns/bantuan-banjir-abc123/disbursements');
        const response = await getCampaignDisbursements(request, {
          params: Promise.resolve({ slug: 'bantuan-banjir-abc123' }),
        });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.disbursements).toHaveLength(2);
        expect(data.disbursements[0].amount).toBe(10000000);
        expect(data.disbursements[1].description).toBe('Biaya transportasi');
      });

      it('only queries payouts with status COMPLETED, never drafts or pending ones', async () => {
        mockFindUnique.mockResolvedValue({ id: 'campaign-1' } as never);
        mockPayoutFindMany.mockResolvedValue([] as never);

        const request = createGetRequest('/api/campaigns/bantuan-banjir-abc123/disbursements');
        await getCampaignDisbursements(request, {
          params: Promise.resolve({ slug: 'bantuan-banjir-abc123' }),
        });

        expect(mockPayoutFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { campaignId: 'campaign-1', status: 'COMPLETED' },
          })
        );
      });

      it('returns 404 if campaign slug does not exist', async () => {
        mockFindUnique.mockResolvedValue(null);

        const request = createGetRequest('/api/campaigns/non-existent/disbursements');
        const response = await getCampaignDisbursements(request, {
          params: Promise.resolve({ slug: 'non-existent' }),
        });
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.code).toBe('NOT_FOUND');
      });
    });
  });

  describe('End-to-End Flow: Create Campaign and Retrieve', () => {
    it('creates a campaign then retrieves it by slug', async () => {
      // Step 1: Create the campaign
      mockGetServerSession.mockResolvedValue(makeVerifiedSession() as never);

      const validBody = {
        title: 'Bantuan Gempa Cianjur',
        description: 'Membantu korban gempa',
        story: '<p>Cerita tentang gempa</p>',
        coverImage: 'https://example.com/gempa.jpg',
        targetAmount: 100000000,
        category: 'bencana-alam',
      };

      const createdCampaign = {
        id: 'campaign-new',
        slug: 'bantuan-gempa-cianjur-a1b2c3',
        ...validBody,
        collectedAmount: 0,
        status: 'active',
        isUrgent: false,
        deadline: null,
        creatorId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        creator: { name: 'Creator', isVerified: true, verificationType: 'ktp' },
      };

      mockCreate.mockResolvedValue(createdCampaign as never);

      const createRequest = createPostRequest('/api/campaigns', validBody);
      const createResponse = await postCampaign(createRequest);
      const createData = await createResponse.json();

      expect(createResponse.status).toBe(201);
      expect(createData.slug).toBe('bantuan-gempa-cianjur-a1b2c3');

      // Step 2: Retrieve the campaign by slug
      const detailCampaign = {
        ...createdCampaign,
        creator: {
          id: 'user-1',
          name: 'Creator',
          avatar: null,
          isVerified: true,
          verificationType: 'ktp',
        },
        _count: { donations: 0 },
      };

      mockFindUnique.mockResolvedValue(detailCampaign as never);

      const detailRequest = createGetRequest('/api/campaigns/bantuan-gempa-cianjur-a1b2c3');
      const detailResponse = await getCampaignDetail(detailRequest, {
        params: Promise.resolve({ slug: 'bantuan-gempa-cianjur-a1b2c3' }),
      });
      const detailData = await detailResponse.json();

      expect(detailResponse.status).toBe(200);
      expect(detailData.campaign.title).toBe('Bantuan Gempa Cianjur');
      expect(detailData.campaign.donationCount).toBe(0);
      expect(detailData.campaign.collectedAmount).toBe(0);
    });
  });
});
