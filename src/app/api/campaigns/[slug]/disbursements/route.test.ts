import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

vi.mock('@/lib/campaign-visibility-route', () => ({
  findViewableCampaign: vi.fn(),
  campaignNotFound: vi.fn(() => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { payout: { findMany: vi.fn() } },
}));

import { findViewableCampaign } from '@/lib/campaign-visibility-route';
import { prisma } from '@/lib/prisma';

const mockFindViewableCampaign = findViewableCampaign as unknown as Mock;
const mockPayoutFindMany = prisma.payout.findMany as unknown as Mock;

function request(): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/disbursements');
}

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-campaign' }) };
}

describe('GET /api/campaigns/[slug]/disbursements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindViewableCampaign.mockResolvedValue({
      id: 'campaign-1',
      respond: (body: unknown) => new Response(JSON.stringify(body), { status: 200 }),
    });
  });

  it('returns 404 for a Campaign that is not publicly viewable', async () => {
    mockFindViewableCampaign.mockResolvedValue(null);
    const response = await GET(request(), routeContext());
    expect(response.status).toBe(404);
    expect(mockPayoutFindMany).not.toHaveBeenCalled();
  });

  it('lists only COMPLETED payouts, as before, and selects the Usage Report public fields -- never submittedById or disputedById', async () => {
    mockPayoutFindMany.mockResolvedValue([]);
    await GET(request(), routeContext());
    expect(mockPayoutFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: 'campaign-1', status: 'COMPLETED', sandbox: false },
        select: expect.objectContaining({
          usageReport: {
            select: {
              id: true,
              narrative: true,
              lineItems: true,
              beneficiaryCount: true,
              photos: true,
              createdAt: true,
              disputedAt: true,
              disputedReason: true,
            },
          },
        }),
      }),
    );
  });

  it('shows simulated disbursements too while the beta marker is on, each flagged sandbox so the page marks it UJI (ticket 94)', async () => {
    vi.stubEnv('BETA_SANDBOX', 'true');
    mockPayoutFindMany.mockResolvedValue([
      { id: 'payout-sim', amount: 100_000, description: 'simulasi', proofImage: null, createdAt: new Date('2026-09-01'), sandbox: true, usageReport: null },
    ]);

    const response = await GET(request(), routeContext());
    const data = await response.json();

    expect(mockPayoutFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: 'campaign-1', status: 'COMPLETED' } }),
    );
    expect(data.disbursements[0].sandbox).toBe(true);
    vi.unstubAllEnvs();
  });

  it('includes usageReport: null for a Payout with no Usage Report yet', async () => {
    mockPayoutFindMany.mockResolvedValue([
      { id: 'payout-1', amount: 300_000, description: 'x', proofImage: 'ref - note', createdAt: new Date('2026-09-01'), usageReport: null },
    ]);

    const response = await GET(request(), routeContext());
    const data = await response.json();

    expect(data.disbursements[0].usageReport).toBeNull();
  });

  it("includes the Usage Report's public fields, and the dispute if there is one", async () => {
    mockPayoutFindMany.mockResolvedValue([
      {
        id: 'payout-1',
        amount: 300_000,
        description: 'x',
        proofImage: 'ref - note',
        createdAt: new Date('2026-09-01'),
        usageReport: {
          id: 'ur-1',
          narrative: 'Dipakai untuk sembako.',
          lineItems: [{ label: 'Sembako', amount: 300_000 }],
          beneficiaryCount: 20,
          photos: ['https://example.com/bukti.jpg'],
          createdAt: new Date('2026-09-05'),
          disputedAt: new Date('2026-09-10'),
          disputedReason: 'Foto tidak sesuai narasi.',
        },
      },
    ]);

    const response = await GET(request(), routeContext());
    const data = await response.json();

    expect(data.disbursements[0].usageReport).toMatchObject({
      id: 'ur-1',
      narrative: 'Dipakai untuk sembako.',
      beneficiaryCount: 20,
      disputedReason: 'Foto tidak sesuai narasi.',
    });
    // Never the submitting or disputing person's id -- this is a public read.
    expect(data.disbursements[0].usageReport).not.toHaveProperty('submittedById');
    expect(data.disbursements[0].usageReport).not.toHaveProperty('disputedById');
  });
});
