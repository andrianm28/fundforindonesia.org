import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { CampaignStatus } from '@/generated/prisma/client';
import {
  campaignMatches,
  campaignRow,
  makeCampaignDb,
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

/**
 * A database with no Campaign in it. Unless a test sets SHOW_DEMO_CAMPAIGNS
 * to `auto` the catalogue decision reads nothing, so which database it is
 * handed does not matter; the `auto` tests build the one they need.
 */
const NO_CAMPAIGNS = makeCampaignDb().prisma as never;

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

  it.each(cases)('a $status Campaign with $label', async ({ status, label, deadline }) => {
    const row = campaignRow({ lifecycleStatus: status, deadline });
    const effective = effectiveStatus(row, NOW);

    const listable = campaignMatches(row, await listableCampaignWhere(NO_CAMPAIGNS, NOW));
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

async function isListed(
  row: CampaignRow,
  options?: { includeDemo?: boolean },
  db: Parameters<typeof listableCampaignWhere>[0] = NO_CAMPAIGNS
): Promise<boolean> {
  return campaignMatches(row, await listableCampaignWhere(db, NOW, options));
}

function isInSitemap(row: CampaignRow): boolean {
  return campaignMatches(row, sitemapCampaignWhere());
}

describe('which Demo Campaigns public listings show', () => {
  it.each(DEMO_ROWS)('lists no %s', async (_label, overrides) => {
    expect(await isListed(campaignRow({ lifecycleStatus: CampaignStatus.ACTIVE, ...overrides }))).toBe(false);
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
  ])('decides by the isDemo column alone, so "%s" changes nothing', async (title) => {
    const demo = campaignRow({ title, lifecycleStatus: CampaignStatus.ACTIVE, isDemo: true });
    const real = campaignRow({ title, lifecycleStatus: CampaignStatus.ACTIVE, isDemo: false });

    expect(await isListed(demo)).toBe(false);
    expect(isInSitemap(demo)).toBe(false);
    expect(await isListed(real)).toBe(true);
    expect(isInSitemap(real)).toBe(true);
  });

  it('still lists one for a privileged screen that asks for them, as an Admin does', async () => {
    const demo = campaignRow({ lifecycleStatus: CampaignStatus.ACTIVE, isDemo: true });

    expect(await isListed(demo, { includeDemo: true })).toBe(true);
  });
});

describe('SHOW_DEMO_CAMPAIGNS (prd-compliance 56)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const demo = () => campaignRow({ lifecycleStatus: CampaignStatus.ACTIVE, isDemo: true });

  it.each([undefined, '', 'false', '1', 'yes', 'TRUE', 'true ', 'AUTO', 'Auto', 'auto '])(
    'is off, and the catalogue hides a Demo Campaign, when the value is %j',
    async (value) => {
      vi.stubEnv('SHOW_DEMO_CAMPAIGNS', value as string);
      if (value === undefined) vi.unstubAllEnvs();

      expect(await showDemoCampaigns(NO_CAMPAIGNS, NOW)).toBe(false);
      expect(await isListed(demo())).toBe(false);
      expect(campaignMatches(demo(), await catalogueDemoWhere(NO_CAMPAIGNS, NOW))).toBe(false);
    }
  );

  it('lists a Demo Campaign, and a real one, when it is exactly "true"', async () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'true');

    expect(await showDemoCampaigns(NO_CAMPAIGNS, NOW)).toBe(true);
    expect(await isListed(demo())).toBe(true);
    expect(await isListed(campaignRow({ lifecycleStatus: CampaignStatus.ACTIVE }))).toBe(true);
    expect(campaignMatches(demo(), await catalogueDemoWhere(NO_CAMPAIGNS, NOW))).toBe(true);
  });

  it('still applies the status rule to a Demo Campaign it lists', async () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'true');

    expect(await isListed(campaignRow({ lifecycleStatus: CampaignStatus.SUSPENDED, isDemo: true }))).toBe(false);
  });

  it('never puts a Demo Campaign in the sitemap, even when on', () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'true');

    expect(isInSitemap(demo())).toBe(false);
  });
});

/**
 * SHOW_DEMO_CAMPAIGNS=auto (rilis-1 ticket 91, owner decision C19): Demo
 * Campaigns are kept while the site has no real Campaign Active, so it is not
 * empty, and leave the public lists on their own from the first real Campaign
 * that is effectively Active.
 */
describe('SHOW_DEMO_CAMPAIGNS=auto (rilis-1 91)', () => {
  beforeEach(() => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'auto');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const demo = (overrides: Partial<CampaignRow> = {}) =>
    campaignRow({ id: 'demo', lifecycleStatus: CampaignStatus.ACTIVE, isDemo: true, ...overrides });
  const real = (overrides: Partial<CampaignRow> = {}) =>
    campaignRow({ id: 'real', lifecycleStatus: CampaignStatus.ACTIVE, isDemo: false, ...overrides });
  const world = (...campaigns: CampaignRow[]) => makeCampaignDb({ campaigns }).prisma as never;

  it('shows Demo Campaigns while no real Campaign is Active', async () => {
    expect(await showDemoCampaigns(world(demo()), NOW)).toBe(true);
  });

  it('hides them from the first real Campaign that is Active, with no change to the environment', async () => {
    expect(await showDemoCampaigns(world(demo(), real()), NOW)).toBe(false);
  });

  // "Active" is the effective status (CONTEXT.md, Campaign Status): the same
  // table that says which Campaigns a list shows says which one counts here,
  // so a real Campaign past its deadline, or Suspended, does not take the
  // Demo Campaigns away. The ticket's default: they come back when the last
  // real Active Campaign leaves Active, with nothing stored to remember it.
  it.each(cases)('a real $status Campaign with $label', async ({ status, label, deadline }) => {
    const shown = await showDemoCampaigns(world(demo(), real({ lifecycleStatus: status, deadline })), NOW);

    expect(shown).toBe(!LISTABLE[status][label]);
  });

  it('counts a real Campaign among many, wherever it sits', async () => {
    const others = [
      real({ id: 'draft', lifecycleStatus: CampaignStatus.DRAFT }),
      real({ id: 'completed', lifecycleStatus: CampaignStatus.COMPLETED }),
      demo({ id: 'demo-2' }),
    ];

    expect(await showDemoCampaigns(world(...others, real({ id: 'the-one' })), NOW)).toBe(false);
    expect(await showDemoCampaigns(world(...others), NOW)).toBe(true);
  });

  describe('what the public lists then show', () => {
    it('lists a Demo Campaign, and no real one yet, in the catalogue and the Prayer Wall while nothing real is Active', async () => {
      const db = world(demo(), real({ lifecycleStatus: CampaignStatus.SUBMITTED }));

      expect(await isListed(demo(), undefined, db)).toBe(true);
      expect(campaignMatches(demo(), await catalogueDemoWhere(db, NOW))).toBe(true);
    });

    it('drops every Demo Campaign from both once a real Campaign is Active, and lists the real one', async () => {
      const db = world(demo(), real());

      expect(await isListed(demo(), undefined, db)).toBe(false);
      expect(campaignMatches(demo(), await catalogueDemoWhere(db, NOW))).toBe(false);
      expect(await isListed(real(), undefined, db)).toBe(true);
      expect(campaignMatches(real(), await catalogueDemoWhere(db, NOW))).toBe(true);
    });

    it('brings them back when the last real Active Campaign leaves Active, with nothing stored to remember it', async () => {
      expect(await isListed(demo(), undefined, world(demo(), real()))).toBe(false);
      expect(await isListed(demo(), undefined, world(demo(), real({ lifecycleStatus: CampaignStatus.COMPLETED })))).toBe(true);
      expect(await isListed(demo(), undefined, world(demo(), real({ lifecycleStatus: CampaignStatus.SUSPENDED })))).toBe(true);
      expect(await isListed(demo(), undefined, world(demo(), real({ deadline: new Date('2026-09-24T12:00:00Z') })))).toBe(true);
    });

    it('still lists a Demo Campaign for a privileged screen that asks for them, real Campaign or not', async () => {
      expect(await isListed(demo(), { includeDemo: true }, world(demo(), real()))).toBe(true);
    });

    it('still applies the status rule to a Demo Campaign it lists', async () => {
      const db = world(demo({ lifecycleStatus: CampaignStatus.SUSPENDED }));

      expect(await isListed(demo({ lifecycleStatus: CampaignStatus.SUSPENDED }), undefined, db)).toBe(false);
    });

    it('never puts a Demo Campaign in the sitemap, whatever it lists', () => {
      expect(isInSitemap(demo())).toBe(false);
    });
  });
});

/**
 * The manual override (rilis-1 91, acceptance 3): exactly "true" lists Demo
 * Campaigns beside real ones, for testing on staging, and `off` values list
 * none, whatever the database holds. Neither asks the database anything.
 */
describe('SHOW_DEMO_CAMPAIGNS as a manual override (rilis-1 91)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const demo = () => campaignRow({ id: 'demo', lifecycleStatus: CampaignStatus.ACTIVE, isDemo: true });
  const real = () => campaignRow({ id: 'real', lifecycleStatus: CampaignStatus.ACTIVE, isDemo: false });

  it('"true" keeps listing Demo Campaigns even though a real Campaign is Active', async () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'true');
    const db = makeCampaignDb({ campaigns: [demo(), real()] }).prisma as never;

    expect(await showDemoCampaigns(db, NOW)).toBe(true);
    expect(await isListed(demo(), undefined, db)).toBe(true);
    expect(campaignMatches(demo(), await catalogueDemoWhere(db, NOW))).toBe(true);
  });

  it.each([undefined, 'false', 'TRUE'])('%j keeps them hidden although no real Campaign is Active', async (value) => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', value as string);
    if (value === undefined) vi.unstubAllEnvs();
    const db = makeCampaignDb({ campaigns: [demo()] }).prisma as never;

    expect(await showDemoCampaigns(db, NOW)).toBe(false);
  });
});

/**
 * What the decision costs (rilis-1 91): at most one bounded read, and only
 * when the switch is `auto` and the caller has not already decided. Never a
 * read per Campaign, never a read for the other values.
 */
describe('what deciding whether to show Demo Campaigns reads', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function watchedWorld(...campaigns: CampaignRow[]) {
    const { prisma } = makeCampaignDb({ campaigns });
    return {
      db: prisma as never,
      findFirst: vi.spyOn(prisma.campaign, 'findFirst'),
      findMany: vi.spyOn(prisma.campaign, 'findMany'),
      count: vi.spyOn(prisma.campaign, 'count'),
    };
  }

  const crowd = Array.from({ length: 40 }, (_, i) =>
    campaignRow({ id: `real-${i}`, lifecycleStatus: CampaignStatus.ACTIVE, isDemo: false })
  );

  it('is one findFirst that selects only the id, however many Campaigns exist', async () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'auto');
    const { db, findFirst, findMany, count } = watchedWorld(...crowd);

    await listableCampaignWhere(db, NOW);

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }));
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it.each([undefined, 'true', 'false', 'yes'])('is no read at all when the value is %j', async (value) => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', value as string);
    if (value === undefined) vi.unstubAllEnvs();
    const { db, findFirst, findMany, count } = watchedWorld(...crowd);

    await listableCampaignWhere(db, NOW);
    await catalogueDemoWhere(db, NOW);

    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('is no read when the caller has already decided, as an Admin screen or a page that decided once does', async () => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'auto');
    const { db, findFirst } = watchedWorld(...crowd);

    await listableCampaignWhere(db, NOW, { includeDemo: true });
    await catalogueDemoWhere(db, NOW, { includeDemo: false });

    expect(findFirst).not.toHaveBeenCalled();
  });
});
