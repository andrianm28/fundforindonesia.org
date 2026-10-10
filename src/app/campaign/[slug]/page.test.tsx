import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * What the Campaign page hands its client view is serialized into the page
 * for every visitor, so it is a payload like any API's: one status field,
 * the effective `lifecycleStatus`, and no legacy `status` string.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    // Public progress asks for the beta Gross to take back out of the counter
    // (counted-payment.ts); none is seeded here.
    payment: { findMany: vi.fn().mockResolvedValue([]) },
    platformFeeRule: { findFirst: vi.fn() },
    platformFeeThreshold: { findFirst: vi.fn() },
  },
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

const capturedStructuredData = vi.hoisted(() => ({ data: null as null | Record<string, unknown> }));
vi.mock('@/components/shared/SEOHead', () => ({
  StructuredData: (props: { data: Record<string, unknown> }) => {
    capturedStructuredData.data = props.data;
    return null;
  },
}));

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
    kind: 'DONATION',
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
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.mocked(prisma.platformFeeRule.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.platformFeeThreshold.findFirst).mockResolvedValue(null as never);
});

describe('the Platform Fee rate in force (prd-compliance 17)', () => {
  it('carries 0 when no rule has been set', async () => {
    const campaign = await campaignHandedToView();
    expect(campaign.platformFeePercentBps).toBe(0);
  });

  it('carries the resolved Kind default rate', async () => {
    vi.mocked(prisma.platformFeeRule.findFirst).mockImplementation(
      (async ({ where }: { where: { scope: string } }) =>
        where.scope === 'KIND' ? { percentBps: 250 } : null) as never,
    );

    const campaign = await campaignHandedToView();

    expect(campaign.platformFeePercentBps).toBe(250);
  });
});

describe('the Campaign page payload', () => {
  it('carries "Donasi uji" (beta Gross) only while the beta marker is on, and keeps it out of progress', async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([{ amount: 30_000, donation: { campaignId: 'campaign-1' } }] as never);

    const live = await campaignHandedToView({ collectedAmount: 100_000 });
    expect(live.testDonationAmount).toBeNull();
    expect(live.collectedAmount).toBe(70_000);

    vi.stubEnv('BETA_SANDBOX', 'true');
    const beta = await campaignHandedToView({ collectedAmount: 100_000 });
    expect(beta.testDonationAmount).toBe(30_000);
    expect(beta.collectedAmount).toBe(70_000);
    vi.mocked(prisma.payment.findMany).mockResolvedValue([]);
  });

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

/** Renders an approved Campaign's page and returns its metadata; the structured data lands in capturedStructuredData. */
async function renderApprovedCampaign() {
  vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row({}) as never);
  const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'sumur-desa' }) });
  render(await CampaignDetailPage({ params: Promise.resolve({ slug: 'sumur-desa' }) }));
  return metadata;
}

describe('the Campaign page links the canonical public site', () => {
  it('falls back to https://fundforindonesia.org in the metadata and the structured data', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');

    const metadata = await renderApprovedCampaign();

    expect(metadata.alternates?.canonical).toBe('https://fundforindonesia.org/campaign/sumur-desa');
    expect(metadata.openGraph).toMatchObject({ url: 'https://fundforindonesia.org/campaign/sumur-desa' });
    expect(capturedStructuredData.data?.url).toBe('https://fundforindonesia.org/campaign/sumur-desa');
  });

  it('uses NEXT_PUBLIC_BASE_URL when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://staging.example.test/');

    const metadata = await renderApprovedCampaign();

    expect(metadata.alternates?.canonical).toBe('https://staging.example.test/campaign/sumur-desa');
    expect(capturedStructuredData.data?.url).toBe('https://staging.example.test/campaign/sumur-desa');
  });
});
