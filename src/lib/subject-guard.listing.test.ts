import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';
import { CampaignStatus } from '@/generated/prisma/client';
import {
  campaignMatches,
  campaignRow,
  type CampaignRow,
} from '../../tests/support/in-memory-campaign-db';
import {
  catalogueDemoWhere,
  effectiveStatus,
  listableCampaignWhere,
  showDemoCampaigns,
  sitemapCampaignWhere,
} from './subject-guard';

/**
 * The list filters and the Campaign page's banner must never disagree
 * (CONTEXT.md, Campaign Status). For every stored status and every kind of
 * deadline, the `where` the readers send is evaluated against the row and
 * compared with `effectiveStatus`.
 */

const NOW = new Date('2026-09-25T12:00:00Z');

type DeadlineCase = 'no deadline' | 'a past deadline' | 'a deadline of exactly now' | 'a future deadline';

const DEADLINES: Record<DeadlineCase, Date | null> = {
  'no deadline': null,
  'a past deadline': new Date('2026-09-24T12:00:00Z'),
  'a deadline of exactly now': new Date(NOW),
  'a future deadline': new Date('2026-09-26T12:00:00Z'),
};

// Written out rather than derived from effectiveStatus, so the table checks
// the helpers against the glossary, not against the code they mirror.
const LISTABLE: Record<CampaignStatus, Record<DeadlineCase, boolean>> = {
  DRAFT: { 'no deadline': false, 'a past deadline': false, 'a deadline of exactly now': false, 'a future deadline': false },
  SUBMITTED: { 'no deadline': false, 'a past deadline': false, 'a deadline of exactly now': false, 'a future deadline': false },
  REJECTED: { 'no deadline': false, 'a past deadline': false, 'a deadline of exactly now': false, 'a future deadline': false },
  ACTIVE: { 'no deadline': true, 'a past deadline': false, 'a deadline of exactly now': true, 'a future deadline': true },
  SUSPENDED: { 'no deadline': false, 'a past deadline': false, 'a deadline of exactly now': false, 'a future deadline': false },
  CANCELLED: { 'no deadline': false, 'a past deadline': false, 'a deadline of exactly now': false, 'a future deadline': false },
  COMPLETED: { 'no deadline': false, 'a past deadline': false, 'a deadline of exactly now': false, 'a future deadline': false },
  EXPIRED: { 'no deadline': false, 'a past deadline': false, 'a deadline of exactly now': false, 'a future deadline': false },
};

const IN_SITEMAP: Record<CampaignStatus, boolean> = {
  DRAFT: false,
  SUBMITTED: false,
  REJECTED: false,
  ACTIVE: true,
  SUSPENDED: false,
  CANCELLED: false,
  COMPLETED: true,
  EXPIRED: true,
};

const cases = Object.values(CampaignStatus).flatMap((status) =>
  (Object.keys(DEADLINES) as DeadlineCase[]).map((label) => ({ status, label, deadline: DEADLINES[label] }))
);

describe('which Campaigns public listings show', () => {
  it('covers every stored status', () => {
    expect(new Set(cases.map((c) => c.status))).toEqual(new Set(Object.keys(LISTABLE)));
  });

  it.each(cases)('a $status Campaign with $label', ({ status, label, deadline }) => {
    const row = campaignRow({ lifecycleStatus: status, deadline });
    const effective = effectiveStatus(row, NOW);

    const listable = campaignMatches(row, listableCampaignWhere(NOW));
    const inSitemap = campaignMatches(row, sitemapCampaignWhere());

    expect(listable).toBe(LISTABLE[status][label]);
    expect(listable).toBe(effective === CampaignStatus.ACTIVE);

    expect(inSitemap).toBe(IN_SITEMAP[status]);
    expect(inSitemap).toBe(
      effective === CampaignStatus.ACTIVE ||
        effective === CampaignStatus.EXPIRED ||
        effective === CampaignStatus.COMPLETED
    );
  });
});

/**
 * A Demo Campaign (CONTEXT.md, Demo Campaign) is fixture data, so no public
 * list shows one whatever status it is in: a visitor must not meet one
 * through a listing, a search, or a link a crawler followed. Which rows those
 * are comes from the `isDemo` column alone -- the Campaign's title, slug and
 * id are not evidence of anything, and no list of them is written down
 * anywhere (prd-compliance 26).
 */
const DEMO_ROWS: Array<[string, Partial<CampaignRow>]> = [
  ['an Active Demo Campaign without a deadline', { isDemo: true }],
  ['an Active Demo Campaign with a future deadline', { isDemo: true, deadline: DEADLINES['a future deadline'] }],
  ['an Active Demo Campaign whose deadline passed', { isDemo: true, deadline: DEADLINES['a past deadline'] }],
  ['a Suspended Demo Campaign', { isDemo: true, lifecycleStatus: CampaignStatus.SUSPENDED }],
  ['an Expired Demo Campaign', { isDemo: true, lifecycleStatus: CampaignStatus.EXPIRED }],
  ['a Completed Demo Campaign', { isDemo: true, lifecycleStatus: CampaignStatus.COMPLETED }],
];

function isListed(row: CampaignRow, options?: { includeDemo?: boolean }): boolean {
  return campaignMatches(row, listableCampaignWhere(NOW, options));
}

function isInSitemap(row: CampaignRow): boolean {
  return campaignMatches(row, sitemapCampaignWhere());
}

describe('which Demo Campaigns public listings show', () => {
  it.each(DEMO_ROWS)('lists no %s', (_label, overrides) => {
    expect(isListed(campaignRow({ lifecycleStatus: CampaignStatus.ACTIVE, ...overrides }))).toBe(false);
  });

  it.each(DEMO_ROWS)('puts no %s in the sitemap', (_label, overrides) => {
    expect(isInSitemap(campaignRow({ lifecycleStatus: CampaignStatus.ACTIVE, ...overrides }))).toBe(false);
  });

  // The rule is the column, not a list of Campaigns: the same row is listed or
  // not depending only on `isDemo`, whatever it is called.
  it.each([
    'Bantu korban bencana (contoh)',
    'Beasiswa Anak Pesisir',
    'demo-campaign',
    'Campaign',
  ])('decides by the isDemo column alone, so "%s" changes nothing', (title) => {
    const demo = campaignRow({ title, lifecycleStatus: CampaignStatus.ACTIVE, isDemo: true });
    const real = campaignRow({ title, lifecycleStatus: CampaignStatus.ACTIVE, isDemo: false });

    expect(isListed(demo)).toBe(false);
    expect(isInSitemap(demo)).toBe(false);
    expect(isListed(real)).toBe(true);
    expect(isInSitemap(real)).toBe(true);
  });

  it('still lists one for a privileged screen that asks for them, as an Admin does', () => {
    const demo = campaignRow({ lifecycleStatus: CampaignStatus.ACTIVE, isDemo: true });

    expect(isListed(demo, { includeDemo: true })).toBe(true);
  });
});

describe('SHOW_DEMO_CAMPAIGNS (prd-compliance 56)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const demo = () => campaignRow({ lifecycleStatus: CampaignStatus.ACTIVE, isDemo: true });

  it.each([undefined, '', 'false', '1', 'yes', 'TRUE', 'true '])(
    'is off, and the catalogue hides a Demo Campaign, when the value is %j',
    (value) => {
      vi.stubEnv('SHOW_DEMO_CAMPAIGNS', value as string);
      if (value === undefined) vi.unstubAllEnvs();

      expect(showDemoCampaigns()).toBe(false);
      expect(isListed(demo())).toBe(false);
      expect(campaignMatches(demo(), catalogueDemoWhere())).toBe(false);
    }
  );

  it('lists a Demo Campaign, and a real one, only when it is exactly "true"', () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'true');

    expect(showDemoCampaigns()).toBe(true);
    expect(isListed(demo())).toBe(true);
    expect(isListed(campaignRow({ lifecycleStatus: CampaignStatus.ACTIVE }))).toBe(true);
    expect(campaignMatches(demo(), catalogueDemoWhere())).toBe(true);
  });

  it('still applies the status rule to a Demo Campaign it lists', () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'true');

    expect(isListed(campaignRow({ lifecycleStatus: CampaignStatus.SUSPENDED, isDemo: true }))).toBe(false);
  });

  it('never puts a Demo Campaign in the sitemap, even when on', () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'true');

    expect(isInSitemap(demo())).toBe(false);
  });
});
