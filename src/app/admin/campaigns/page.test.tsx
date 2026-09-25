import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import AdminCampaignsPage from './page';

describe('AdminCampaignsPage actions', () => {
  afterEach(() => {
    cleanup();
  });

  it('offers no way to delete a Campaign, since a Campaign stops only through its lifecycle (ADR 0016)', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      {
        id: 'campaign-1',
        slug: 'sumur-desa',
        title: 'Sumur untuk Desa',
        status: 'active',
        targetAmount: 10_000_000,
        collectedAmount: 2_500_000,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        creator: { name: 'Budi', email: 'budi@test.com' },
      },
    ] as any);

    render(await AdminCampaignsPage());

    const row = screen.getByText('Sumur untuk Desa').closest('tr')!;
    expect(within(row).getByText('Lihat')).toBeDefined();
    expect(within(row).queryByRole('button', { name: /hapus/i })).toBeNull();
    expect(within(row).queryByText(/hapus/i)).toBeNull();
  });
});
