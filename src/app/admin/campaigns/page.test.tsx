import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CampaignStatus } from '@/generated/prisma/client';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
    },
  },
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
        lifecycleStatus: 'ACTIVE',
        deadline: null,
        targetAmount: 10_000_000,
        collectedAmount: 2_500_000,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        creator: { name: 'Budi', email: 'budi@test.com' },
      },
    ] as any);

    render(await AdminCampaignsPage());

    const row = screen.getByText('Sumur untuk Desa').closest('tr')!;
    expect(within(row).getByText('Lihat')).toBeDefined();
    expect(within(row).queryByText(/hapus/i)).toBeNull();
  });
});

describe('AdminCampaignsPage status badges', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function row(title: string, lifecycleStatus: CampaignStatus, deadline: Date | null = null) {
    return {
      id: title,
      slug: title,
      title,
      lifecycleStatus,
      deadline,
      targetAmount: 10_000_000,
      collectedAmount: 0,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      creator: { name: 'Budi', email: 'budi@test.com' },
    };
  }

  async function badgeOf(title: string): Promise<string> {
    const tr = screen.getByText(title).closest('tr')!;
    return within(tr).getAllByRole('cell')[2].textContent ?? '';
  }

  it('shows each Campaign Status by its Indonesian badge label', async () => {
    const statuses: [CampaignStatus, string][] = [
      ['DRAFT', 'Draf'],
      ['SUBMITTED', 'Diajukan'],
      ['REJECTED', 'Ditolak'],
      ['ACTIVE', 'Aktif'],
      ['SUSPENDED', 'Dibekukan'],
      ['CANCELLED', 'Ditarik'],
      ['COMPLETED', 'Selesai'],
      ['EXPIRED', 'Berakhir'],
    ];
    vi.mocked(prisma.campaign.findMany).mockResolvedValue(
      statuses.map(([status]) => row(`campaign-${status}`, status)) as any,
    );

    render(await AdminCampaignsPage());

    for (const [status, label] of statuses) {
      expect(await badgeOf(`campaign-${status}`)).toBe(label);
    }
  });

  it('shows an Active Campaign past its deadline as Expired, before anyone records it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      row('lapsed', 'ACTIVE', new Date('2026-09-24T12:00:00Z')),
      row('running', 'ACTIVE', new Date('2026-09-26T12:00:00Z')),
    ] as any);

    render(await AdminCampaignsPage());

    expect(await badgeOf('lapsed')).toBe('Berakhir');
    expect(await badgeOf('running')).toBe('Aktif');
  });
});
