import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * A zakat Campaign's public page exists only while the zakat module is ON
 * (PKS pemenuhan 19, ADR 0028): while OFF it is the same 404 as a Campaign
 * that does not exist.
 */

const holder = vi.hoisted(() => ({ operations: null as unknown }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    payment: { findMany: vi.fn().mockResolvedValue([]) },
    platformFeeRule: { findFirst: vi.fn() },
    platformFeeThreshold: { findFirst: vi.fn() },
    escrowHoldSetting: { findFirst: vi.fn().mockResolvedValue(null) },
    siteSetting: {
      findUnique: vi.fn(async () =>
        holder.operations ? { key: 'operations', value: holder.operations, updatedAt: new Date(1) } : null,
      ),
    },
  },
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/components/campaign/CampaignDetailView', () => ({ CampaignDetailView: () => null }));
vi.mock('@/components/shared/SEOHead', () => ({ StructuredData: () => null }));

import { prisma } from '@/lib/prisma';
import CampaignDetailPage from './page';

function row(kind: string) {
  return {
    id: 'campaign-1',
    slug: 'zakat-yayasan',
    title: 'Zakat melalui Yayasan',
    description: 'Deskripsi',
    story: '<p>Cerita</p>',
    coverImage: 'https://example.com/a.jpg',
    targetAmount: 10_000_000,
    collectedAmount: 0,
    category: 'lingkungan',
    kind,
    lifecycleStatus: 'ACTIVE',
    isUrgent: false,
    isDemo: false,
    deadline: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    creator: { id: 'u1', name: 'Budi', avatar: null },
    _count: { donations: 0 },
  };
}

const ON = {
  donationsOpen: true,
  maintenance: { on: false, message: '' },
  zakat: { enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' },
  history: [],
};

const open = () => CampaignDetailPage({ params: Promise.resolve({ slug: 'zakat-yayasan' }) });

beforeEach(() => {
  holder.operations = null;
});
afterEach(cleanup);

describe('the page of a zakat Campaign', () => {
  it('is a 404 while the module is OFF (the default)', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row('ZAKAT') as never);
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders while the module is ON', async () => {
    holder.operations = ON;
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row('ZAKAT') as never);
    render(await open());
  });

  it('never asks about zakat for a Campaign of another Kind', async () => {
    vi.mocked(prisma.siteSetting.findUnique).mockClear();
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row('DONATION') as never);
    render(await open());
    expect(prisma.siteSetting.findUnique).not.toHaveBeenCalled();
  });
});
