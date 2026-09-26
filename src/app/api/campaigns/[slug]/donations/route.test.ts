import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    donation: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('@/lib/campaign-visibility-route', () => ({
  findViewableCampaign: vi.fn(),
  campaignNotFound: vi.fn(() => NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 })),
}));

import { GET } from './route';
import { prisma } from '@/lib/prisma';
import { findViewableCampaign } from '@/lib/campaign-visibility-route';

const mockDonationFindMany = prisma.donation.findMany as unknown as Mock;
const mockDonationCount = prisma.donation.count as unknown as Mock;
const mockFindViewableCampaign = findViewableCampaign as unknown as Mock;

function listRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/banjir/donations');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindViewableCampaign.mockResolvedValue({
    id: 'campaign-1',
    respond: (body: unknown) => NextResponse.json(body),
  });
  mockDonationCount.mockResolvedValue(0);
});

describe('GET /api/campaigns/[slug]/donations -- Guest Donor names (prd-compliance 18)', () => {
  it("shows a non-anonymous Guest Donor's name instead of always 'Anonim'", async () => {
    mockDonationFindMany.mockResolvedValue([
      { id: 'd1', amount: 50_000, isAnonymous: false, message: null, createdAt: new Date(), donor: null, guestName: 'Tamu Baik' },
    ]);

    const response = await GET(listRequest(), { params: Promise.resolve({ slug: 'banjir' }) });
    const data = await response.json();

    expect(data.donations[0].donorName).toBe('Tamu Baik');
  });

  it('still hides an anonymous Guest Donor behind "Anonim"', async () => {
    mockDonationFindMany.mockResolvedValue([
      { id: 'd1', amount: 50_000, isAnonymous: true, message: null, createdAt: new Date(), donor: null, guestName: 'Tamu Baik' },
    ]);

    const response = await GET(listRequest(), { params: Promise.resolve({ slug: 'banjir' }) });
    const data = await response.json();

    expect(data.donations[0].donorName).toBe('Anonim');
  });

  it('falls back to "Anonim" for a Guest Donor who left no name at all', async () => {
    mockDonationFindMany.mockResolvedValue([
      { id: 'd1', amount: 50_000, isAnonymous: false, message: null, createdAt: new Date(), donor: null, guestName: null },
    ]);

    const response = await GET(listRequest(), { params: Promise.resolve({ slug: 'banjir' }) });
    const data = await response.json();

    expect(data.donations[0].donorName).toBe('Anonim');
  });

  it("prefers a registered Donor's own name over guestName (which is always null for them)", async () => {
    mockDonationFindMany.mockResolvedValue([
      {
        id: 'd1',
        amount: 50_000,
        isAnonymous: false,
        message: null,
        createdAt: new Date(),
        donor: { name: 'Andi Wijaya' },
        guestName: null,
      },
    ]);

    const response = await GET(listRequest(), { params: Promise.resolve({ slug: 'banjir' }) });
    const data = await response.json();

    expect(data.donations[0].donorName).toBe('Andi Wijaya');
  });
});
