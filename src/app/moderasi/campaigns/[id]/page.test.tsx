import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CampaignStatus } from '@/generated/prisma/client';

vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn() } },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import ModerasiCampaignDetailPage from './page';

function campaign(lifecycleStatus: CampaignStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: 'campaign-1',
    title: 'Sumur untuk Desa',
    lifecycleStatus,
    deadline: null,
    coverImage: '',
    description: 'Deskripsi',
    story: '<p>Cerita</p>',
    category: 'lingkungan',
    targetAmount: 10_000_000,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    creator: { name: 'Budi', email: 'budi@test.com' },
    ...overrides,
  };
}

async function renderFor(row: ReturnType<typeof campaign>) {
  vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row as any);
  render(await ModerasiCampaignDetailPage({ params: Promise.resolve({ id: row.id }) }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the moderation page of one Campaign', () => {
  it('offers approve and reject for a Submitted Campaign', async () => {
    await renderFor(campaign('SUBMITTED'));

    expect(screen.getByText('Diajukan')).toBeDefined();
    expect(screen.getByRole('button', { name: /Setujui/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Tolak/ })).toBeDefined();
  });

  it.each<CampaignStatus>(['DRAFT', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'CANCELLED', 'COMPLETED', 'EXPIRED'])(
    'offers no decision for a %s Campaign',
    async (status) => {
      await renderFor(campaign(status));

      expect(screen.queryByRole('button', { name: /Setujui/ })).toBeNull();
      expect(screen.getByText('Kampanye ini sudah dimoderasi dengan status saat ini.')).toBeDefined();
    },
  );

  it('shows an Active Campaign past its deadline as Expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));

    await renderFor(campaign('ACTIVE', { deadline: new Date('2026-09-24T12:00:00Z') }));

    expect(screen.getByText('Berakhir')).toBeDefined();
  });
});
