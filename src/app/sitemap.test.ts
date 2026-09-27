import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * The sitemap lists Active Campaigns and ended (Expired, Completed) ones, so
 * an ended Campaign's transparency page stays findable; Suspended, Cancelled
 * and not-yet-approved Campaigns are listed nowhere (CONTEXT.md, Campaign
 * Status).
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../tests/support/in-memory-campaign-db').makeCampaignDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key: string) {
        if (key === 'category') return { findMany: async () => [] };
        return (holder.db.prisma as Record<string, unknown>)[key];
      },
    }
  ),
}));

import sitemap from './sitemap';

const NOW = new Date('2026-09-25T12:00:00Z');
const YESTERDAY = new Date('2026-09-24T12:00:00Z');

function campaign(slug: string, overrides: Partial<CampaignRow> = {}): CampaignRow {
  return campaignRow({ id: slug, slug, title: slug, lifecycleStatus: 'ACTIVE', ...overrides });
}

async function campaignSlugsInSitemap(): Promise<string[]> {
  const entries = await sitemap();
  return entries
    .map((entry) => /\/campaign\/([^/]+)$/.exec(entry.url)?.[1])
    .filter((slug): slug is string => slug !== undefined)
    .sort();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  holder.db = makeCampaignDb({
    campaigns: [
      campaign('active'),
      // Stored ACTIVE with a past deadline: effectively Expired.
      campaign('expired-unrecorded', { deadline: YESTERDAY }),
      campaign('expired', { lifecycleStatus: 'EXPIRED', deadline: YESTERDAY }),
      campaign('completed', { lifecycleStatus: 'COMPLETED' }),
      campaign('suspended', { lifecycleStatus: 'SUSPENDED' }),
      campaign('cancelled', { lifecycleStatus: 'CANCELLED' }),
      campaign('submitted', { lifecycleStatus: 'SUBMITTED' }),
      campaign('rejected', { lifecycleStatus: 'REJECTED' }),
      campaign('draft', { lifecycleStatus: 'DRAFT' }),
      // Fiction is listed nowhere, so a crawler is never sent to one
      // (CONTEXT.md, Demo Campaign; prd-compliance 26).
      campaign('demo-active', { isDemo: true }),
      campaign('demo-expired', { isDemo: true, lifecycleStatus: 'EXPIRED', deadline: YESTERDAY }),
      campaign('demo-completed', { isDemo: true, lifecycleStatus: 'COMPLETED' }),
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sitemap Campaign pages', () => {
  it('includes Active, Expired and Completed Campaigns and excludes Suspended, Cancelled and unapproved ones', async () => {
    expect(await campaignSlugsInSitemap()).toEqual(['active', 'completed', 'expired', 'expired-unrecorded']);
  });

  it('sends a crawler to no Demo Campaign page, in any status', async () => {
    const slugs = await campaignSlugsInSitemap();
    expect(slugs.filter((slug) => slug.startsWith('demo-'))).toEqual([]);
  });
});

describe('the sitemap links the canonical public site', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to https://fundforindonesia.org when NEXT_PUBLIC_BASE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');

    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain('https://fundforindonesia.org');
    expect(urls).toContain('https://fundforindonesia.org/campaign/active');
    expect(urls.every((url) => url.startsWith('https://fundforindonesia.org'))).toBe(true);
  });

  it('uses NEXT_PUBLIC_BASE_URL, without its trailing slash', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://staging.example.test/');

    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain('https://staging.example.test');
    expect(urls).toContain('https://staging.example.test/zakat');
  });
});
