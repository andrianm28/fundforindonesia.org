import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findMany: vi.fn() },
    cancellationRequest: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import AdminCampaignLifecycleQueuePage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * ticket 25 (map.md FFI-07b/07: "Layar Admin menjatuhkan/mencabut
 * Suspension" -- 0 hasil). Three groups: Campaigns with an open Flag
 * (candidates for Suspension), Campaigns already SUSPENDED (candidates for
 * lifting), and pending Cancellation requests -- each links to the detail
 * page that acts on it.
 */
describe('AdminCampaignLifecycleQueuePage', () => {
  it('lists a flagged Campaign under "menunggu keputusan suspension", linking to its detail page', async () => {
    vi.mocked(prisma.campaign.findMany).mockImplementation(((args: {
      where: { flags?: unknown; lifecycleStatus?: unknown };
    }) => {
      if (args.where.flags) {
        return Promise.resolve([
          { id: 'c1', slug: 'sumur-desa', title: 'Sumur untuk Desa' },
        ]);
      }
      return Promise.resolve([]);
    }) as never);
    vi.mocked(prisma.cancellationRequest.findMany).mockResolvedValue([] as never);

    render(await AdminCampaignLifecycleQueuePage());

    expect(screen.getByText(/menunggu keputusan suspension/i)).toBeDefined();
    const row = screen.getByText('Sumur untuk Desa').closest('tr')!;
    const link = within(row).getByRole('link', { name: /tinjau/i });
    expect(link.getAttribute('href')).toBe('/admin/campaigns/lifecycle/sumur-desa');
  });

  it('lists a SUSPENDED Campaign under "bisa dicabut"', async () => {
    vi.mocked(prisma.campaign.findMany).mockImplementation(((args: {
      where: { flags?: unknown; lifecycleStatus?: unknown };
    }) => {
      if (args.where.lifecycleStatus) {
        return Promise.resolve([
          { id: 'c2', slug: 'bantuan-banjir', title: 'Bantuan Banjir' },
        ]);
      }
      return Promise.resolve([]);
    }) as never);
    vi.mocked(prisma.cancellationRequest.findMany).mockResolvedValue([] as never);

    render(await AdminCampaignLifecycleQueuePage());

    expect(screen.getByText(/bisa dicabut/i)).toBeDefined();
    expect(screen.getByText('Bantuan Banjir')).toBeDefined();
  });

  it('lists a pending Cancellation request under its own section', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.cancellationRequest.findMany).mockResolvedValue([
      {
        id: 'req-1',
        reason: 'Sudah tidak butuh dana lagi.',
        campaign: { slug: 'sumur-desa', title: 'Sumur untuk Desa' },
      },
    ] as never);

    render(await AdminCampaignLifecycleQueuePage());

    expect(screen.getByText(/pengajuan cancellation/i)).toBeDefined();
    const row = screen.getByText('Sumur untuk Desa').closest('tr')!;
    const link = within(row).getByRole('link', { name: /tinjau/i });
    expect(link.getAttribute('href')).toBe('/admin/campaigns/lifecycle/sumur-desa');
  });

  it('says so when every queue is empty rather than showing empty tables', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.cancellationRequest.findMany).mockResolvedValue([] as never);

    render(await AdminCampaignLifecycleQueuePage());

    expect(screen.getAllByText(/tidak ada/i).length).toBeGreaterThan(0);
  });
});
