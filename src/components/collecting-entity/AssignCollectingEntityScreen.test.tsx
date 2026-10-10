import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // findFirst is how the public catalogue asks whether a real Campaign is
    // Active; this screen must never need to.
    campaign: { findMany: vi.fn(), findFirst: vi.fn() },
    partnerOrganisation: { findMany: vi.fn() },
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { prisma } from '@/lib/prisma';
import { campaignMatches, campaignRow } from '../../../tests/support/in-memory-campaign-db';
import { AssignCollectingEntityScreen } from './AssignCollectingEntityScreen';

/**
 * The dedicated screen where an Admin or Verifier names the Collecting
 * Entity of an Active Campaign that has none (prd-compliance 10).
 */
const ORGANISATIONS = [
  { id: 'yiem', name: 'YIEM', fundraiserId: 'yiem-account', acceptsIndividualCampaigns: false },
  { id: 'sponsor', name: 'Yayasan Penaung', fundraiserId: 'other', acceptsIndividualCampaigns: true },
];

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(prisma.partnerOrganisation.findMany).mockResolvedValue(ORGANISATIONS as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderWith(campaigns: unknown[]) {
  vi.mocked(prisma.campaign.findMany).mockResolvedValue(campaigns as never);
  render(await AssignCollectingEntityScreen());
}

describe('AssignCollectingEntityScreen', () => {
  it('asks only for effectively Active Campaigns that name no Collecting Entity', async () => {
    await renderWith([]);

    const { where } = vi.mocked(prisma.campaign.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(where).toMatchObject({ collectingEntityId: null });
    expect(where.AND).toBeDefined();
    expect(screen.getByText('Semua Campaign Aktif sudah memiliki Collecting Entity.')).toBeDefined();
  });

  it("offers an organisation's own account only its organisation, and an individual those accepting individual Campaigns", async () => {
    await renderWith([
      { slug: 'yiem-campaign', title: 'Sumur Desa', creatorId: 'yiem-account', creator: { name: 'YIEM' } },
      { slug: 'solo-campaign', title: 'Operasi Adik', creatorId: 'budi', creator: { name: 'Budi' } },
    ]);

    const own = screen.getByLabelText('Collecting Entity', { selector: '#entity-yiem-campaign' }) as HTMLSelectElement;
    expect(Array.from(own.options).map((o) => o.value)).toEqual(['', 'yiem']);
    expect(own.value).toBe('yiem');
    const solo = screen.getByLabelText('Collecting Entity', { selector: '#entity-solo-campaign' }) as HTMLSelectElement;
    expect(Array.from(solo.options).map((o) => o.value)).toEqual(['', 'sponsor']);
  });

  it('still offers a Demo Campaign, which no public list shows (CONTEXT.md, Demo Campaign)', async () => {
    // The exclusion is for visitors, not for the people who have to work on a
    // Campaign: an Admin keeps every Campaign in front of them
    // (prd-compliance 26).
    const { where } = vi.mocked(prisma.campaign.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    const demo = campaignRow({ lifecycleStatus: 'ACTIVE', isDemo: true, collectingEntityId: null });

    expect(campaignMatches(demo, where)).toBe(true);
    expect(campaignMatches(campaignRow({ lifecycleStatus: 'SUSPENDED', collectingEntityId: null }), where)).toBe(false);
  });

  it('still offers a Demo Campaign when a real Campaign is Active and SHOW_DEMO_CAMPAIGNS=auto has hidden it from visitors (rilis-1 91)', async () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'auto');
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({ id: 'real-active' } as never);
    await renderWith([]);

    const { where } = vi.mocked(prisma.campaign.findMany).mock.calls.at(-1)![0] as { where: Record<string, unknown> };
    const demo = campaignRow({ lifecycleStatus: 'ACTIVE', isDemo: true, collectingEntityId: null });

    expect(campaignMatches(demo, where)).toBe(true);
    expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
  });

  it('assigns the chosen organisation with a reason', async () => {
    await renderWith([{ slug: 'solo-campaign', title: 'Operasi Adik', creatorId: 'budi', creator: { name: 'Budi' } }]);

    fireEvent.change(screen.getByLabelText('Collecting Entity'), { target: { value: 'sponsor' } });
    fireEvent.change(screen.getByLabelText('Alasan'), { target: { value: 'Campaign lama.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tetapkan' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/campaigns/solo-campaign/collecting-entity');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ collectingEntityId: 'sponsor', reason: 'Campaign lama.' });
  });
});
