import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CampaignStatus } from '@/generated/prisma/client';
import {
  campaignRow,
  makeCampaignDb,
} from '../../../../tests/support/in-memory-campaign-db';

/**
 * The Verifier's queue holds exactly the Campaigns awaiting a Verifier:
 * the Submitted ones (CONTEXT.md, Campaign Status). Run against the
 * in-memory Campaign db, so it asserts which Campaigns are listed, not how
 * the query is built.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-campaign-db').makeCampaignDb>,
}));

// The page shows each Campaign's creator and target, which the in-memory
// rows do not carry; they are filled in so the page can render.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: async (args: object) =>
        (await holder.db.prisma.campaign.findMany(args)).map((row: object) => ({
          ...row,
          targetAmount: 1_000_000,
          createdAt: new Date('2026-09-01T00:00:00Z'),
          creator: { name: 'Budi', email: 'budi@test.com' },
        })),
    },
  },
}));

import ModerasiCampaignsPage from './page';

function campaign(title: string, lifecycleStatus: CampaignStatus) {
  return campaignRow({ id: title, slug: title, title, lifecycleStatus });
}

beforeEach(() => {
  holder.db = makeCampaignDb({
    campaigns: [
      campaign('submitted-one', 'SUBMITTED'),
      campaign('submitted-two', 'SUBMITTED'),
      campaign('draft', 'DRAFT'),
      campaign('active', 'ACTIVE'),
      campaign('rejected', 'REJECTED'),
      campaign('suspended', 'SUSPENDED'),
    ],
  });
});

afterEach(() => cleanup());

describe('the Verifier queue', () => {
  it('lists the Submitted Campaigns and nothing else', async () => {
    render(await ModerasiCampaignsPage());

    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent).sort();
    expect(titles).toEqual(['submitted-one', 'submitted-two']);
  });

  it('lists a Submitted Campaign even when its legacy status string says otherwise', async () => {
    holder.db = makeCampaignDb({
      campaigns: [campaignRow({ id: 'x', slug: 'x', title: 'mismatched', status: 'active', lifecycleStatus: 'SUBMITTED' })],
    });

    render(await ModerasiCampaignsPage());

    expect(screen.getByText('mismatched')).toBeDefined();
  });
});
