import { describe, it, expect } from 'vitest';
import { CampaignStatus } from '@/generated/prisma/client';
import { campaignMatches, campaignRow } from '../../tests/support/in-memory-campaign-db';
import { effectiveStatus, listableCampaignWhere, sitemapCampaignWhere } from './subject-guard';

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
