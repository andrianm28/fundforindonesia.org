import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: { donation: { findMany: vi.fn() } } }));
vi.mock('@/lib/campaign-visibility-route', () => ({
  findViewableCampaign: vi.fn(),
  campaignNotFound: vi.fn(() => NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 })),
}));

import { GET } from './route';
import { prisma } from '@/lib/prisma';
import { findViewableCampaign } from '@/lib/campaign-visibility-route';

const findMany = prisma.donation.findMany as unknown as Mock;
const viewable = findViewableCampaign as unknown as Mock;
const call = () =>
  GET(new NextRequest('http://localhost:3000/api/campaigns/banjir/top-donors'), {
    params: Promise.resolve({ slug: 'banjir' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  viewable.mockResolvedValue({ id: 'camp-1', respond: (body: unknown) => NextResponse.json(body) });
});

describe('GET /api/campaigns/[slug]/top-donors', () => {
  it('answers 404 for a Campaign the viewer may not see, without reading any Donation', async () => {
    viewable.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('lists donors with anonymous ones as Anonim and no identifying field', async () => {
    findMany.mockResolvedValue([
      { amount: 700_000, isAnonymous: true, guestName: 'Rahasia', donor: { name: 'Rahasia' } },
      { amount: 100_000, isAnonymous: false, guestName: null, donor: { name: 'Dewi' } },
    ]);

    const body = await (await call()).json();

    expect(body.donors).toEqual([
      { rank: 1, donorName: 'Anonim', amount: 700_000 },
      { rank: 2, donorName: 'Dewi', amount: 100_000 },
    ]);
    expect(JSON.stringify(body)).not.toContain('Rahasia');
  });
});
