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
    expect(urls).not.toContain('https://staging.example.test/zakat');
  });
});

describe('the sitemap lists the module landings', () => {
  it('includes the CSR portfolio, the CSR, Wakaf and Hibah landings', async () => {
    holder.db = makeCampaignDb({ campaigns: [] });
    const urls = (await sitemap()).map((entry) => new URL(entry.url).pathname);

    expect(urls).toEqual(expect.arrayContaining(['/program', '/kolaborasi-csr', '/wakaf', '/hibah']));
  });
});

describe('the sitemap uses the renamed Indonesian URLs (Q1)', () => {
  it('lists /jelajah/semua and /jelajah/<category>, and none of the old /explore URLs', async () => {
    holder.db = makeCampaignDb({ campaigns: [] });
    const urls = (await sitemap()).map((entry) => new URL(entry.url).pathname);
    expect(urls).toContain('/jelajah/semua');
    expect(urls.some((p) => p.startsWith('/explore'))).toBe(false);
  });
});

describe('the sitemap pairs Indonesian and English pages (Q2), only with the English gate open', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const BASE = 'https://fundforindonesia.org';
  const byPath = (entries: Awaited<ReturnType<typeof sitemap>>) =>
    new Map(entries.map((e) => [new URL(e.url).pathname, e]));

  it('with the gate closed: no /en URL and no alternates', async () => {
    holder.db = makeCampaignDb({ campaigns: [campaign('active')] });
    const entries = await sitemap();
    expect(entries.some((e) => new URL(e.url).pathname.startsWith('/en'))).toBe(false);
    expect(entries.some((e) => e.alternates !== undefined)).toBe(false);
  });

  it('with the gate open: each paired page gets an /en entry and id plus en alternates on both', async () => {
    vi.stubEnv('I18N_ENGLISH_ENABLED', 'true');
    holder.db = makeCampaignDb({ campaigns: [campaign('active')] });
    const map = byPath(await sitemap());

    const wakaf = { id: `${BASE}/wakaf`, en: `${BASE}/en/waqf` };
    expect(map.get('/wakaf')!.alternates).toEqual({ languages: wakaf });
    expect(map.get('/en/waqf')!.alternates).toEqual({ languages: wakaf });

    expect(map.get('/jelajah/semua')!.alternates).toEqual({
      languages: { id: `${BASE}/jelajah/semua`, en: `${BASE}/en/explore/all` },
    });
    expect(map.has('/en/explore/all')).toBe(true);
    expect(map.get('/hibah')!.alternates).toEqual({ languages: { id: `${BASE}/hibah`, en: `${BASE}/en/hibah` } });
    expect(map.get('/campaign/active')!.alternates).toEqual({
      languages: { id: `${BASE}/campaign/active`, en: `${BASE}/en/campaign/active` },
    });
    expect(map.get('/')!.alternates).toEqual({ languages: { id: BASE, en: `${BASE}/en` } });
    expect(map.has('/en')).toBe(true);
  });

  it('leaves a page with no English counterpart alone', async () => {
    vi.stubEnv('I18N_ENGLISH_ENABLED', 'true');
    holder.db = makeCampaignDb({ campaigns: [] });
    const map = byPath(await sitemap());
    expect(map.get('/kolaborasi-csr')!.alternates).toBeUndefined();
    expect(map.has('/en/kolaborasi-csr')).toBe(false);
  });
});
