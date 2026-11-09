import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * The home page's lists (the Urgent rail, "Yang Baru", "Pilihan Kami") show
 * only effectively Active Campaigns (CONTEXT.md, Campaign Status). The page
 * runs against the in-memory Campaign db and the test reads which Campaigns
 * it hands to each section.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../tests/support/in-memory-campaign-db').makeCampaignDb>,
  // Typed with its argument so a test can read the `where` the page passed,
  // the way the prayers route test reads its own mock.
  prayerFindMany: vi.fn(async (_args: { where: Record<string, unknown> }) => []),
  // Admin curation (PKS pemenuhan 15): the marks, as the tables hold them.
  features: [] as Array<{ kind: string; campaignId: string; position: number }>,
  highlightFindMany: vi.fn<(args: { where: Record<string, unknown> }) => Promise<unknown[]>>(async () => []),
  categories: [] as Array<{ slug: string; name: string; order: number }>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key: string) {
        if (key === 'prayer') return { findMany: holder.prayerFindMany };
        if (key === 'prayerHighlight') return { findMany: holder.highlightFindMany };
        if (key === 'category') return { findMany: async () => holder.categories };
        if (key === 'campaignFeature') {
          return {
            findMany: async ({ where }: { where: { kind: string } }) =>
              holder.features
                .filter((f) => f.kind === where.kind)
                .sort((a, b) => a.position - b.position)
                .map((f) => ({ campaignId: f.campaignId })),
          };
        }
        return (holder.db.prisma as Record<string, unknown>)[key];
      },
    }
  ),
}));

import HomePage from './page';
import { UrgentCampaigns } from '@/components/home/UrgentCampaigns';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import { CategoryFeatured } from '@/components/home/CategoryFeatured';
import { PrayerHighlights } from '@/components/home/PrayerHighlights';

const NOW = new Date('2026-09-25T12:00:00Z');
const YESTERDAY = new Date('2026-09-24T12:00:00Z');
const TOMORROW = new Date('2026-09-26T12:00:00Z');

function campaign(slug: string, overrides: Partial<CampaignRow> = {}): CampaignRow {
  return campaignRow({ id: slug, slug, title: slug, lifecycleStatus: 'ACTIVE', ...overrides });
}

/** The `campaigns` prop of every element of the given component type in the tree. */
function campaignsPassedTo(node: ReactNode, type: unknown): string[][] {
  if (Array.isArray(node)) return node.flatMap((child) => campaignsPassedTo(child, type));
  if (!isValidElement(node)) return [];
  const props = node.props as { campaigns?: Array<{ slug: string }>; children?: ReactNode };
  const here = node.type === type && props.campaigns ? [props.campaigns.map((c) => c.slug).sort()] : [];
  return [...here, ...campaignsPassedTo(props.children, type)];
}

beforeEach(() => {
  holder.features = [];
  holder.categories = [];
  holder.highlightFindMany.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  holder.db = makeCampaignDb({
    campaigns: [
      campaign('urgent-active', { isUrgent: true, deadline: TOMORROW }),
      // Stored ACTIVE and urgent, but its deadline passed yesterday.
      campaign('urgent-expired-unrecorded', { isUrgent: true, deadline: YESTERDAY }),
      campaign('urgent-suspended', { isUrgent: true, lifecycleStatus: 'SUSPENDED' }),
      campaign('urgent-cancelled', { isUrgent: true, lifecycleStatus: 'CANCELLED' }),
      campaign('active'),
      campaign('submitted', { lifecycleStatus: 'SUBMITTED' }),
      campaign('draft', { lifecycleStatus: 'DRAFT' }),
      campaign('urgent-draft', { isUrgent: true, lifecycleStatus: 'DRAFT' }),
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('home page Campaign lists', () => {
  it('the Urgent rail drops a Campaign once it is effectively Expired, and never shows Suspended or Cancelled ones', async () => {
    const page = await HomePage();
    expect(campaignsPassedTo(page, UrgentCampaigns)).toEqual([['urgent-active']]);
  });

  it('"Yang Baru" and "Pilihan Kami" show only effectively Active Campaigns', async () => {
    const page = await HomePage();
    expect(campaignsPassedTo(page, CampaignGrid)).toEqual([
      ['active', 'urgent-active'],
      ['active', 'urgent-active'],
    ]);
  });

  it('writes nothing while rendering', async () => {
    const before = holder.db.campaigns.map((c) => ({ ...c }));
    await HomePage();
    expect(holder.db.campaigns).toEqual(before);
    expect(holder.db.statusChanges).toEqual([]);
  });
});

describe('the home page and a Demo Campaign', () => {
  // Whatever section a visitor lands on first, fiction is not in it
  // (CONTEXT.md, Demo Campaign; prd-compliance 26).
  beforeEach(() => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaign('active', { isUrgent: true }),
        campaign('demo-newest', { isDemo: true }),
        campaign('demo-urgent', { isDemo: true, isUrgent: true, deadline: TOMORROW }),
        campaign('demo-biggest', { isDemo: true, targetAmount: 900_000_000 }),
      ],
    });
  });

  it('shows no Demo Campaign in the Urgent rail, in "Yang Baru" or in "Pilihan Kami"', async () => {
    const page = await HomePage();
    expect(campaignsPassedTo(page, UrgentCampaigns)).toEqual([['active']]);
    expect(campaignsPassedTo(page, CampaignGrid)).toEqual([['active'], ['active']]);
  });

  it('names no Demo Campaign in the Prayer Wall, which links to the Campaign it names', async () => {
    await HomePage();

    const { where } = holder.prayerFindMany.mock.calls[0][0];
    expect(where).toEqual({ hidden: false, deletedAt: null, campaign: { isDemo: false } });
  });
});

describe('the home page with SHOW_DEMO_CAMPAIGNS on (prd-compliance 56)', () => {
  beforeEach(() => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'true');
    holder.db = makeCampaignDb({
      campaigns: [
        campaign('active', { isUrgent: true }),
        campaign('demo-urgent', { isDemo: true, isUrgent: true, deadline: TOMORROW }),
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows a Demo Campaign in the Urgent rail, and the Prayer Wall no longer leaves its Campaign out', async () => {
    const page = await HomePage();
    expect(campaignsPassedTo(page, UrgentCampaigns)[0].sort()).toEqual(['active', 'demo-urgent']);

    const { where } = holder.prayerFindMany.mock.calls.at(-1)![0];
    expect(where).toEqual({ hidden: false, deletedAt: null, campaign: {} });
  });
});

/**
 * SHOW_DEMO_CAMPAIGNS=auto (rilis-1 91): the page keeps the Demo Campaigns
 * until the first real Campaign is Active, in the lists and in the Prayer
 * Wall alike, and drops them from both together.
 */
describe('the home page with SHOW_DEMO_CAMPAIGNS=auto (rilis-1 91)', () => {
  beforeEach(() => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'auto');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows a Demo Campaign in the Urgent rail, and lets the Prayer Wall name its Campaign, while no real Campaign is Active', async () => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaign('demo-urgent', { isDemo: true, isUrgent: true, deadline: TOMORROW }),
        campaign('real-draft', { lifecycleStatus: 'DRAFT' }),
      ],
    });

    const page = await HomePage();

    expect(campaignsPassedTo(page, UrgentCampaigns)).toEqual([['demo-urgent']]);
    expect(campaignsPassedTo(page, CampaignGrid)).toEqual([['demo-urgent'], ['demo-urgent']]);
    const { where } = holder.prayerFindMany.mock.calls.at(-1)![0];
    expect(where).toEqual({ hidden: false, deletedAt: null, campaign: {} });
  });

  it('shows no Demo Campaign in any list, and the Prayer Wall names none, once a real Campaign is Active', async () => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaign('real', { isUrgent: true }),
        campaign('demo-urgent', { isDemo: true, isUrgent: true, deadline: TOMORROW }),
        campaign('demo-newest', { isDemo: true }),
      ],
    });

    const page = await HomePage();

    expect(campaignsPassedTo(page, UrgentCampaigns)).toEqual([['real']]);
    expect(campaignsPassedTo(page, CampaignGrid)).toEqual([['real'], ['real']]);
    const { where } = holder.prayerFindMany.mock.calls.at(-1)![0];
    expect(where).toEqual({ hidden: false, deletedAt: null, campaign: { isDemo: false } });
  });

  it('decides once for the whole page, with one bounded read of the Campaigns', async () => {
    holder.db = makeCampaignDb({ campaigns: [campaign('real'), campaign('demo', { isDemo: true })] });
    const findFirst = vi.spyOn(holder.db.prisma.campaign, 'findFirst');

    await HomePage();

    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

/** The slugs a component of `type` was handed, in order (not sorted, unlike campaignsPassedTo). */
function orderedCampaignsPassedTo(node: ReactNode, type: unknown, variant?: string): string[][] {
  if (Array.isArray(node)) return node.flatMap((child) => orderedCampaignsPassedTo(child, type, variant));
  if (!isValidElement(node)) return [];
  const props = node.props as { campaigns?: Array<{ slug: string }>; variant?: string; children?: ReactNode };
  const here =
    node.type === type && props.campaigns && (!variant || props.variant === variant)
      ? [props.campaigns.map((c) => c.slug)]
      : [];
  return [...here, ...orderedCampaignsPassedTo(props.children, type, variant)];
}

function elementsOf<P>(node: ReactNode, type: unknown): P[] {
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf<P>(child, type));
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [...(node.type === type ? [node.props as P] : []), ...elementsOf<P>(props.children, type)];
}

describe('the home page uses the Admin curation (PKS pemenuhan 15)', () => {
  beforeEach(() => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaign('a'),
        campaign('b'),
        campaign('c'),
        campaign('draft', { lifecycleStatus: 'DRAFT' }),
        campaign('expired', { deadline: YESTERDAY }),
      ],
    });
  });

  it('"Pilihan Kami" shows the marked Campaigns in the Admin order, not in the automatic order', async () => {
    holder.features = [
      { kind: 'PILIHAN', campaignId: 'c', position: 0 },
      { kind: 'PILIHAN', campaignId: 'a', position: 1 },
    ];

    const page = await HomePage();

    expect(orderedCampaignsPassedTo(page, CampaignGrid, 'standard')).toEqual([['c', 'a']]);
  });

  it('a marked Campaign that is not publicly visible (draft, expired) never appears, marked or not', async () => {
    holder.features = [
      { kind: 'PILIHAN', campaignId: 'draft', position: 0 },
      { kind: 'PILIHAN', campaignId: 'expired', position: 1 },
      { kind: 'PILIHAN', campaignId: 'b', position: 2 },
    ];

    const page = await HomePage();

    expect(orderedCampaignsPassedTo(page, CampaignGrid, 'standard')).toEqual([['b']]);
  });

  it('falls back to the automatic order when nothing is marked, or nothing marked is visible', async () => {
    const automatic = orderedCampaignsPassedTo(await HomePage(), CampaignGrid, 'standard');
    expect(automatic).toEqual([['a', 'b', 'c']]);

    holder.features = [{ kind: 'PILIHAN', campaignId: 'draft', position: 0 }];
    expect(orderedCampaignsPassedTo(await HomePage(), CampaignGrid, 'standard')).toEqual(automatic);
  });

  it('"Unggulan kategori" shows each Category its own marked, visible Campaigns, in order, and no section for a Category with none', async () => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaign('m1', { category: 'masjid' }),
        campaign('m2', { category: 'masjid' }),
        campaign('s1', { category: 'sekolah' }),
        campaign('s-draft', { category: 'sekolah', lifecycleStatus: 'DRAFT' }),
        campaign('k1', { category: 'kesehatan' }),
      ],
    });
    holder.categories = [
      { slug: 'masjid', name: 'Masjid', order: 1 },
      { slug: 'sekolah', name: 'Sekolah', order: 2 },
      { slug: 'kesehatan', name: 'Kesehatan', order: 3 },
    ];
    holder.features = [
      { kind: 'UNGGULAN_KATEGORI', campaignId: 'm2', position: 0 },
      { kind: 'UNGGULAN_KATEGORI', campaignId: 'm1', position: 1 },
      { kind: 'UNGGULAN_KATEGORI', campaignId: 's-draft', position: 2 },
    ];

    const page = await HomePage();

    const [props] = elementsOf<{ groups: Array<{ slug: string; campaigns: Array<{ slug: string }> }> }>(page, CategoryFeatured);
    expect(props.groups.map((g) => [g.slug, g.campaigns.map((c) => c.slug)])).toEqual([['masjid', ['m2', 'm1']]]);
  });

  it('shows no "Unggulan kategori" at all when nothing is marked', async () => {
    expect(elementsOf(await HomePage(), CategoryFeatured)).toEqual([]);
  });

  it('"Sorotan doa" shows the marked Prayers in order, read through the public Prayer rule and the Demo filter', async () => {
    const prayer = (id: string) => ({
      id,
      text: `doa ${id}`,
      amiinCount: 0,
      donationId: `d-${id}`,
      campaignId: 'c1',
      userId: null,
      createdAt: new Date('2026-09-20T00:00:00Z'),
      user: null,
      campaign: { id: 'c1', slug: 'a', title: 'A' },
      donation: { isAnonymous: true },
    });
    holder.highlightFindMany.mockResolvedValueOnce([{ prayer: prayer('p2') }, { prayer: prayer('p1') }]);

    const page = await HomePage();

    const { where } = holder.highlightFindMany.mock.calls[0][0];
    expect(where).toEqual({ prayer: { hidden: false, deletedAt: null, campaign: { isDemo: false } } });
    const [props] = elementsOf<{ prayers: Array<{ id: string }> }>(page, PrayerHighlights);
    expect(props.prayers.map((p) => p.id)).toEqual(['p2', 'p1']);
  });
});
