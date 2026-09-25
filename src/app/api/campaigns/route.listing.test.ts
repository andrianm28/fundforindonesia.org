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
  return campaignRow({ id: slug, slug, title: slug, status: 'active', lifecycleStatus: 'ACTIVE', ...overrides });
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
      campaign('suspended', { status: 'suspended', lifecycleStatus: 'SUSPENDED' }),
      campaign('cancelled', { status: 'cancelled', lifecycleStatus: 'CANCELLED' }),
      campaign('submitted', { status: 'pending', lifecycleStatus: 'SUBMITTED' }),
      campaign('completed', { status: 'completed', lifecycleStatus: 'COMPLETED' }),
      campaign('expired', { status: 'active', lifecycleStatus: 'EXPIRED', deadline: YESTERDAY }),
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/campaigns lists only effectively Active Campaigns', () => {
  it('shows effectively Active Campaigns and hides effectively Expired, Suspended, Cancelled, Submitted and Completed ones', async () => {
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

  it('writes nothing while listing', async () => {
    const before = holder.db.campaigns.map((c) => ({ ...c }));
    await listSlugs();
    expect(holder.db.campaigns).toEqual(before);
    expect(holder.db.statusChanges).toEqual([]);
  });
});
