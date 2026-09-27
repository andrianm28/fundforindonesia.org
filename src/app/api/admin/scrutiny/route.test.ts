import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The Admin's window on the money thresholds (prd-compliance 38, PRD
 * §"Anti penyalahgunaan"): a Campaign that crossed the audit limit, a single
 * Donation that crossed the single-Donation limit, the Fundraisers already at
 * their Active Campaign limit, and the limits themselves. Nothing here
 * changes anything; it is the list an Admin reads to decide who to ask.
 *
 * ADMIN only, like every other operator route.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    abuseThreshold: { findMany: vi.fn() },
    campaignAuditMarker: { findMany: vi.fn() },
    donationReviewMarker: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
  },
}));

import { GET } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockThresholds = prisma.abuseThreshold.findMany as unknown as Mock;
const mockAuditMarkers = prisma.campaignAuditMarker.findMany as unknown as Mock;
const mockDonationMarkers = prisma.donationReviewMarker.findMany as unknown as Mock;
const mockCampaigns = prisma.campaign.findMany as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/scrutiny';

function get(): Promise<Response> {
  return GET(new NextRequest(URL), { params: Promise.resolve({}) });
}

describe('GET /api/admin/scrutiny', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockThresholds.mockResolvedValue([]);
    mockAuditMarkers.mockResolvedValue([]);
    mockDonationMarkers.mockResolvedValue([]);
    mockCampaigns.mockResolvedValue([]);
  });

  it('answers the limits in force, so the panel shows what the platform is actually applying', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      thresholds: {
        campaignReviewGross: 100_000_000,
        campaignAuditGross: 500_000_000,
        donationReviewAmount: 50_000_000,
        activeCampaignsPerFundraiser: 3,
      },
    });
  });

  it('lists the Campaigns under an audit marker and the Donations flagged for an Admin', async () => {
    mockAuditMarkers.mockResolvedValue([
      {
        id: 'audit-1',
        campaignId: 'campaign-1',
        cumulativeGross: 600_000_000,
        threshold: 500_000_000,
        placedAt: new Date('2026-09-28T05:00:00Z'),
        campaign: { id: 'campaign-1', title: 'Bantu Korban Banjir', slug: 'bantu-korban-banjir' },
      },
    ]);
    mockDonationMarkers.mockResolvedValue([
      {
        id: 'marker-1',
        donationId: 'donation-1',
        campaignId: 'campaign-1',
        amount: 75_000_000,
        threshold: 50_000_000,
        flaggedAt: new Date('2026-09-28T05:00:00Z'),
        campaign: { id: 'campaign-1', title: 'Bantu korban Banjir', slug: 'bantu-korban-banjir' },
      },
    ]);

    const body = await (await get()).json();

    expect(body.auditMarkers).toEqual([
      expect.objectContaining({ campaignId: 'campaign-1', title: 'Bantu Korban Banjir', cumulativeGross: 600_000_000 }),
    ]);
    expect(body.donationReviewMarkers).toEqual([
      expect.objectContaining({ donationId: 'donation-1', amount: 75_000_000, title: 'Bantu korban Banjir' }),
    ]);
  });

  it('lists the Fundraisers already at their Active Campaign limit, and leaves the ones below it out', async () => {
    mockCampaigns.mockResolvedValue([
      { id: 'c1', creatorId: 'creator-1', lifecycleStatus: 'ACTIVE', deadline: new Date('2026-12-31T00:00:00Z') },
      { id: 'c2', creatorId: 'creator-1', lifecycleStatus: 'ACTIVE', deadline: new Date('2026-12-31T00:00:00Z') },
      { id: 'c3', creatorId: 'creator-1', lifecycleStatus: 'ACTIVE', deadline: new Date('2026-12-31T00:00:00Z') },
      { id: 'c4', creatorId: 'creator-2', lifecycleStatus: 'ACTIVE', deadline: new Date('2026-12-31T00:00:00Z') },
    ]);

    const body = await (await get()).json();

    expect(body.fundraisersAtActiveLimit).toEqual([{ fundraiserId: 'creator-1', activeCampaigns: 3 }]);
  });

  it('answers 401 with no session, and 403 for anyone who is not an Admin', async () => {
    mockSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    expect((await get()).status).toBe(403);

    expect(mockAuditMarkers).not.toHaveBeenCalled();
  });
});
