import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../tests/support/in-memory-campaign-db';

/**
 * The public Campaign list (explore/all and search) shows only
 * effectively Active Campaigns (CONTEXT.md, Campaign Status). Run against
 * the in-memory Campaign db, so the test asserts which Campaigns come back,
 * not how the query is built.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-campaign-db').makeCampaignDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key: string) => (holder.db.prisma as Record<string, unknown>)[key] }),
}));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));

import { GET } from './route';

const NOW = new Date('2026-09-25T12:00:00Z');
const YESTERDAY = new Date('2026-09-24T12:00:00Z');
const TOMORROW = new Date('2026-09-26T12:00:00Z');

function campaign(slug: string, overrides: Partial<CampaignRow> = {}): CampaignRow {
  return campaignRow({ id: slug, slug, title: slug, lifecycleStatus: 'ACTIVE', ...overrides });
}

async function listSlugs(query = ''): Promise<string[]> {
  const response = await GET(new NextRequest(new URL(`http://localhost:3000/api/campaigns${query}`)));
  expect(response.status).toBe(200);
  const body = await response.json();
  return body.campaigns.map((c: { slug: string }) => c.slug).sort();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  holder.db = makeCampaignDb({
    campaigns: [
      campaign('active-no-deadline'),
      campaign('active-until-tomorrow', { deadline: TOMORROW, isUrgent: true }),
      // Stored ACTIVE, but its deadline passed and nobody recorded it yet.
      campaign('expired-unrecorded', { deadline: YESTERDAY, isUrgent: true }),
      campaign('suspended', { lifecycleStatus: 'SUSPENDED' }),
      campaign('cancelled', { lifecycleStatus: 'CANCELLED' }),
      campaign('submitted', { lifecycleStatus: 'SUBMITTED' }),
      // Titled so a search for "active" would find them if the rule slipped.
      campaign('draft-active', { lifecycleStatus: 'DRAFT' }),
      campaign('rejected-active', { lifecycleStatus: 'REJECTED' }),
      campaign('completed', { lifecycleStatus: 'COMPLETED' }),
      campaign('expired', { lifecycleStatus: 'EXPIRED', deadline: YESTERDAY }),
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/campaigns lists only effectively Active Campaigns', () => {
  it('shows effectively Active Campaigns and hides effectively Expired, Suspended, Cancelled, Draft, Submitted, Rejected and Completed ones', async () => {
    expect(await listSlugs()).toEqual(['active-no-deadline', 'active-until-tomorrow']);
  });

  it('counts only what it lists', async () => {
    const response = await GET(new NextRequest(new URL('http://localhost:3000/api/campaigns')));
    expect((await response.json()).total).toBe(2);
  });

  it('drops a Campaign from the urgent list once its deadline passes', async () => {
    expect(await listSlugs('?urgent=true')).toEqual(['active-until-tomorrow']);
  });

  it('keeps the rule when searching, even though search adds its own OR', async () => {
    expect(await listSlugs('?search=active')).toEqual(['active-no-deadline', 'active-until-tomorrow']);
    expect(await listSlugs('?search=expired')).toEqual([]);
  });

  // Regression for the ?status= leak (effective-status-listings ticket 01).
  it.each(['pending', 'suspended', 'cancelled', 'completed'])(
    'returns no hidden Campaign for ?status=%s',
    async (status) => {
      expect(await listSlugs(`?status=${status}`)).toEqual(['active-no-deadline', 'active-until-tomorrow']);
    }
  );

  it('sends lifecycleStatus and no legacy status string', async () => {
    const response = await GET(new NextRequest(new URL('http://localhost:3000/api/campaigns')));
    const { campaigns } = await response.json();

    expect(campaigns.length).toBeGreaterThan(0);
    for (const campaign of campaigns) {
      expect(campaign.lifecycleStatus).toBe('ACTIVE');
      expect(campaign).not.toHaveProperty('status');
    }
  });

  it('writes nothing while listing', async () => {
    const before = holder.db.campaigns.map((c) => ({ ...c }));
    await listSlugs();
    expect(holder.db.campaigns).toEqual(before);
    expect(holder.db.statusChanges).toEqual([]);
  });
});

describe('GET /api/campaigns and a Demo Campaign', () => {
  // CONTEXT.md, Demo Campaign: its data is fiction, so nothing here may show
  // it -- the catalogue a visitor browses, the urgent list they scan, the
  // search they run, or the count above their results (prd-compliance 26).
  beforeEach(() => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaign('active', { title: 'Pemulihan Gudang' }),
        campaign('demo-active', { isDemo: true, title: 'Bantu korban bencana (contoh)' }),
        campaign('demo-urgent', { isDemo: true, isUrgent: true, title: 'Beasiswa Pesisir (contoh)' }),
        campaign('demo-with-a-future-deadline', { isDemo: true, deadline: TOMORROW }),
      ],
    });
  });

  it('lists no Demo Campaign, in the catalogue or in the urgent list', async () => {
    expect(await listSlugs()).toEqual(['active']);
    expect(await listSlugs('?urgent=true')).toEqual([]);
  });

  it('counts only the Campaigns it lists', async () => {
    const response = await GET(new NextRequest(new URL('http://localhost:3000/api/campaigns')));
    expect((await response.json()).total).toBe(1);
  });

  it('finds a Demo Campaign by neither its title nor its slug', async () => {
    expect(await listSlugs('?search=korban')).toEqual([]);
    expect(await listSlugs('?search=contoh')).toEqual([]);
    expect(await listSlugs('?search=demo')).toEqual([]);
    // A search that matches nothing real still shows nothing, and the Demo
    // Campaign is not the consolation prize.
    expect(await listSlugs('?search=Pemulihan')).toEqual(['active']);
  });
});

describe('GET /api/campaigns filters by Kind', () => {
  beforeEach(() => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaign('donasi', { kind: 'DONATION' }),
        campaign('zakat', { kind: 'ZAKAT' }),
        campaign('wakaf-no-deadline', { kind: 'WAKAF' }),
        campaign('wakaf-expired-unrecorded', { kind: 'WAKAF', deadline: YESTERDAY }),
        campaign('wakaf-suspended', { kind: 'WAKAF', lifecycleStatus: 'SUSPENDED' }),
        campaign('hibah', { kind: 'HIBAH' }),
      ],
    });
  });

  it('lists only the effectively Active Campaigns of the Kind asked for', async () => {
    expect(await listSlugs('?kind=WAKAF')).toEqual(['wakaf-no-deadline']);
    expect(await listSlugs('?kind=HIBAH')).toEqual(['hibah']);
  });

  it('accepts the Kind in lower case, as links write it', async () => {
    expect(await listSlugs('?kind=zakat')).toEqual(['zakat']);
  });

  it('lists every Kind when none is asked for', async () => {
    expect(await listSlugs()).toEqual(['donasi', 'hibah', 'wakaf-no-deadline', 'zakat']);
  });

  it('answers 400 to a Kind the platform does not know, rather than an empty list', async () => {
    const response = await GET(new NextRequest(new URL('http://localhost:3000/api/campaigns?kind=infaq')));
    expect(response.status).toBe(400);
  });
});
