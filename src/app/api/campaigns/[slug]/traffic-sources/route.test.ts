import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /api/campaigns/[slug]/traffic-sources (ticket 24, "Traffic Source on
 * Donation"): "Counts per link are visible to the Fundraiser." This is
 * per-Donor-traffic analytics, not public campaign content, so it answers
 * only its Campaign's Fundraiser or an Admin -- everyone else gets the same
 * refusal the other owner-only routes give (refuseUnlessFundraiserOrAdmin).
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    donation: { groupBy: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));

import { GET } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockDonationGroupBy = prisma.donation.groupBy as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-slug/traffic-sources');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCampaignFindUnique.mockResolvedValue({
    id: 'campaign-1',
    creatorId: 'fundraiser-1',
    lifecycleStatus: 'ACTIVE',
    deadline: null,
  });
  mockDonationGroupBy.mockResolvedValue([
    { trafficSource: 'whatsapp', _count: { _all: 3 } },
    { trafficSource: null, _count: { _all: 5 } },
  ]);
});

describe('GET /api/campaigns/[slug]/traffic-sources', () => {
  it('answers 404 for a slug that does not exist, without leaking that it never existed vs. is private', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1' } });

    const response = await GET(createRequest(), { params: Promise.resolve({ slug: 'nope' }) });

    expect(response.status).toBe(404);
  });

  it('refuses a signed-in stranger', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else' } });

    const response = await GET(createRequest(), { params: Promise.resolve({ slug: 'test-slug' }) });

    expect(response.status).toBe(403);
  });

  it('refuses a guest with no session', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({ slug: 'test-slug' }) });

    expect(response.status).toBe(403);
  });

  it('answers 404, not 403, for a stranger the Campaign visibility rule already hides an unapproved Campaign from', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'fundraiser-1',
      lifecycleStatus: 'DRAFT',
      deadline: null,
    });
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else' } });

    const response = await GET(createRequest(), { params: Promise.resolve({ slug: 'test-slug' }) });

    expect(response.status).toBe(404);
  });

  it("still answers the Fundraiser for their own unapproved Campaign", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'fundraiser-1',
      lifecycleStatus: 'DRAFT',
      deadline: null,
    });
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1' } });

    const response = await GET(createRequest(), { params: Promise.resolve({ slug: 'test-slug' }) });

    expect(response.status).toBe(200);
  });

  it("answers the campaign's own Fundraiser with counts per source", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1' } });

    const response = await GET(createRequest(), { params: Promise.resolve({ slug: 'test-slug' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sources).toEqual(
      expect.arrayContaining([
        { source: 'whatsapp', count: 3 },
        { source: null, count: 5 },
      ]),
    );
  });

  it('counts only confirmed donations', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1' } });

    await GET(createRequest(), { params: Promise.resolve({ slug: 'test-slug' }) });

    expect(mockDonationGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: 'campaign-1', paymentStatus: 'confirmed' },
      }),
    );
  });
});
