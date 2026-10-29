import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../tests/support/in-memory-campaign-db';

/**
 * A Category page lists the effectively Active Campaigns in its Category
 * (CONTEXT.md, Campaign Status), and follows the same Demo Campaign decision
 * as every public list (CONTEXT.md, Demo Campaign; rilis-1 91). It runs
 * against the in-memory Campaign db, so the test reads which Campaigns the
 * page hands to its grid, not how the query is built.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-campaign-db').makeCampaignDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key: string) {
        if (key === 'category') return { findUnique: async () => ({ slug: 'kesehatan', name: 'Kesehatan' }) };
        if (key === 'campaign') {
          const campaign = holder.db.prisma.campaign;
          // The page shows the Fundraiser's name, which the stand-in does not join.
          return {
            ...campaign,
            findMany: async (args: Parameters<typeof campaign.findMany>[0]) =>
              (await campaign.findMany(args)).map((row) => ({ ...row, creator: { name: 'Fundraiser' } })),
          };
        }
        return (holder.db.prisma as Record<string, unknown>)[key];
      },
    }
  ),
}));

import CategoryPage from './page';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';

const NOW = new Date('2026-09-25T12:00:00Z');
const YESTERDAY = new Date('2026-09-24T12:00:00Z');

function campaign(slug: string, overrides: Partial<CampaignRow> = {}): CampaignRow {
  return campaignRow({ id: slug, slug, title: slug, category: 'kesehatan', lifecycleStatus: 'ACTIVE', ...overrides });
}

/** The `campaigns` prop of every element of the given component type in the tree. */
function campaignsPassedTo(node: ReactNode, type: unknown): string[][] {
  if (Array.isArray(node)) return node.flatMap((child) => campaignsPassedTo(child, type));
  if (!isValidElement(node)) return [];
  const props = node.props as { campaigns?: Array<{ slug: string }>; children?: ReactNode };
  const here = node.type === type && props.campaigns ? [props.campaigns.map((c) => c.slug).sort()] : [];
  return [...here, ...campaignsPassedTo(props.children, type)];
}

async function listedSlugs(): Promise<string[]> {
  const page = await CategoryPage({ params: Promise.resolve({ category: 'kesehatan' }) });
  return campaignsPassedTo(page, CampaignGrid)[0];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('a Category page', () => {
  it('lists only the effectively Active Campaigns of its Category, and no Demo Campaign', async () => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaign('active'),
        campaign('expired-unrecorded', { deadline: YESTERDAY }),
        campaign('suspended', { lifecycleStatus: 'SUSPENDED' }),
        campaign('draft', { lifecycleStatus: 'DRAFT' }),
        campaign('other-category', { category: 'pendidikan' }),
        campaign('demo', { isDemo: true }),
      ],
    });

    expect(await listedSlugs()).toEqual(['active']);
  });
});

describe('a Category page with SHOW_DEMO_CAMPAIGNS=auto (rilis-1 91)', () => {
  beforeEach(() => {
    vi.stubEnv('SHOW_DEMO_CAMPAIGNS', 'auto');
  });

  it('lists a Demo Campaign while no real Campaign is Active', async () => {
    holder.db = makeCampaignDb({ campaigns: [campaign('demo', { isDemo: true }), campaign('draft', { lifecycleStatus: 'DRAFT' })] });

    expect(await listedSlugs()).toEqual(['demo']);
  });

  it('lists none once a real Campaign is Active, in this Category or any other', async () => {
    holder.db = makeCampaignDb({
      campaigns: [campaign('demo', { isDemo: true }), campaign('real-elsewhere', { category: 'pendidikan' })],
    });

    expect(await listedSlugs()).toEqual([]);
  });
});
