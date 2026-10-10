import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../../tests/support/in-memory-campaign-db';

/**
 * The zakat list shows Campaigns in the Category zakat or kemanusiaan, under
 * the same effectively-Active rule as every public list (CONTEXT.md,
 * Campaign Status).
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../../tests/support/in-memory-campaign-db').makeCampaignDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key: string) => (holder.db.prisma as Record<string, unknown>)[key] }),
}));

import { GET } from './route';

const NOW = new Date('2026-09-25T12:00:00Z');
const YESTERDAY = new Date('2026-09-24T12:00:00Z');
const TOMORROW = new Date('2026-09-26T12:00:00Z');

function campaign(slug: string, overrides: Partial<CampaignRow> = {}): CampaignRow {
  return campaignRow({
    id: slug,
    slug,
    title: slug,
    category: 'zakat',
    lifecycleStatus: 'ACTIVE',
    ...overrides,
  });
}

async function listSlugs(): Promise<string[]> {
  const response = await GET(new NextRequest(new URL('http://localhost:3000/api/zakat/campaigns')));
  expect(response.status).toBe(200);
  const body = await response.json();
  return body.campaigns.map((c: { slug: string }) => c.slug).sort();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  holder.db = makeCampaignDb({
    campaigns: [
      campaign('zakat-active'),
      campaign('kemanusiaan-active', { category: 'kemanusiaan', deadline: TOMORROW }),
      campaign('zakat-expired-unrecorded', { deadline: YESTERDAY }),
      campaign('zakat-suspended', { lifecycleStatus: 'SUSPENDED' }),
      campaign('zakat-cancelled', { lifecycleStatus: 'CANCELLED' }),
      campaign('zakat-submitted', { lifecycleStatus: 'SUBMITTED' }),
      campaign('zakat-draft', { lifecycleStatus: 'DRAFT' }),
      campaign('zakat-rejected', { lifecycleStatus: 'REJECTED' }),
      campaign('zakat-completed', { lifecycleStatus: 'COMPLETED' }),
      campaign('kesehatan-active', { category: 'kesehatan' }),
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/zakat/campaigns lists only effectively Active Campaigns in its Categories', () => {
  it('hides effectively Expired, Suspended, Cancelled, Draft, Submitted, Rejected and Completed Campaigns', async () => {
    expect(await listSlugs()).toEqual(['kemanusiaan-active', 'zakat-active']);
  });

  it('counts only what it lists', async () => {
    const response = await GET(new NextRequest(new URL('http://localhost:3000/api/zakat/campaigns')));
    expect((await response.json()).total).toBe(2);
  });
});

/**
 * SHOW_DEMO_CAMPAIGNS=auto (rilis-1 91): the zakat list keeps its Demo
 * Campaigns until a real Campaign is Active anywhere on the platform, not
 * only in its own Categories -- one decision for every list.
 */
describe('GET /api/zakat/campaigns with SHOW_DEMO_CAMPAIGNS=auto (rilis-1 91)', () => {
  beforeEach(() => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'auto');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const demo = () => campaign('zakat-demo', { isDemo: true });

  it('lists a Demo Campaign while no real Campaign is Active', async () => {
    holder.db = makeCampaignDb({ campaigns: [demo(), campaign('zakat-draft', { lifecycleStatus: 'DRAFT' })] });

    expect(await listSlugs()).toEqual(['zakat-demo']);
  });

  it('lists none once a real Campaign is Active, whatever Category it is in', async () => {
    holder.db = makeCampaignDb({ campaigns: [demo(), campaign('kesehatan-real', { category: 'kesehatan' })] });

    expect(await listSlugs()).toEqual([]);
  });

  it('lists the real zakat Campaigns beside nothing fictional', async () => {
    holder.db = makeCampaignDb({ campaigns: [demo(), campaign('zakat-real')] });

    expect(await listSlugs()).toEqual(['zakat-real']);
  });
});
