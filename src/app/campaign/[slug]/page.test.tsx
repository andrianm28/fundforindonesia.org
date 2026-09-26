import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * What the Campaign page hands its client view is serialized into the page
 * for every visitor, so it is a payload like any API's: one status field,
 * the effective `lifecycleStatus`, and no legacy `status` string.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn() } },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const view = vi.hoisted(() => ({ props: null as null | { campaign: Record<string, unknown> } }));
vi.mock('@/components/campaign/CampaignDetailView', () => ({
  CampaignDetailView: (props: { campaign: Record<string, unknown> }) => {
    view.props = props;
    return null;
  },
}));

vi.mock('@/components/shared/SEOHead', () => ({ StructuredData: () => null }));

import { prisma } from '@/lib/prisma';
import CampaignDetailPage from './page';

function row(overrides: Record<string, unknown>) {
  return {
    id: 'campaign-1',
    slug: 'sumur-desa',
    title: 'Sumur untuk Desa',
    description: 'Deskripsi',
    story: '<p>Cerita</p>',
    coverImage: 'https://example.com/a.jpg',
    targetAmount: 10_000_000,
    collectedAmount: 0,
    category: 'lingkungan',
    lifecycleStatus: 'ACTIVE',
    isUrgent: false,
    isDemo: false,
    deadline: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    creator: { id: 'u1', name: 'Budi', avatar: null },
    _count: { donations: 0 },
    ...overrides,
  };
}

async function campaignHandedToView(overrides: Record<string, unknown> = {}) {
  vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row(overrides) as any);
  render(await CampaignDetailPage({ params: Promise.resolve({ slug: 'sumur-desa' }) }));
  return view.props!.campaign;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the Campaign page payload', () => {
  it('carries lifecycleStatus and no legacy status string', async () => {
    const campaign = await campaignHandedToView();

    expect(campaign.lifecycleStatus).toBe('ACTIVE');
    expect(campaign).not.toHaveProperty('status');
  });

  it('carries an Active Campaign past its deadline as EXPIRED', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));

    const campaign = await campaignHandedToView({ deadline: new Date('2026-09-24T12:00:00Z') });

    expect(campaign.lifecycleStatus).toBe('EXPIRED');
  });
});
