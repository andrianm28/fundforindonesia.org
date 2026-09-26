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
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key: string) {
        if (key === 'prayer') return { findMany: async () => [] };
        return (holder.db.prisma as Record<string, unknown>)[key];
      },
    }
  ),
}));

import HomePage from './page';
import { UrgentCampaigns } from '@/components/home/UrgentCampaigns';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';

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
