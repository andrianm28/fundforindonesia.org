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
import CampaignDetailPage, { generateMetadata } from './page';

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

/**
 * This page is ISR: one render is cached and served to every visitor, so it
 * cannot know who is looking. An unapproved Campaign therefore renders the
 * 404 for everyone here; its Fundraiser, Verifiers and Admins see it through
 * the not-found view, which asks the session-aware API.
 */
describe('an unapproved Campaign on the cached page', () => {
  it.each(['DRAFT', 'SUBMITTED', 'REJECTED'])('renders the 404 while %s', async (status) => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row({ lifecycleStatus: status }) as any);
    view.props = null;

    await expect(
      CampaignDetailPage({ params: Promise.resolve({ slug: 'sumur-desa' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(view.props).toBeNull();
  });

  it.each(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED'])('still renders once %s', async (status) => {
    const campaign = await campaignHandedToView({ lifecycleStatus: status });
    expect(campaign.lifecycleStatus).toBe(status);
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED'])(
    'keeps the title and description out of the metadata while %s',
    async (status) => {
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row({ lifecycleStatus: status }) as any);

      const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'sumur-desa' }) });

      expect(JSON.stringify(metadata)).not.toContain('Sumur untuk Desa');
      expect(JSON.stringify(metadata)).not.toContain('Deskripsi');
      expect(metadata.title).toBe('Campaign Tidak Ditemukan');
    }
  );

  it('still describes an approved Campaign in the metadata', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row({}) as any);

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'sumur-desa' }) });

    expect(metadata.title).toBe('Sumur untuk Desa - Fund for Indonesia');
  });
});
