import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findMany: vi.fn() },
    partnerOrganisation: { findMany: vi.fn() },
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { prisma } from '@/lib/prisma';
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
