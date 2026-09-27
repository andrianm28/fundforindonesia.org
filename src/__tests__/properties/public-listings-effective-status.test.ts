import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Every public list of Campaigns decides what it shows through the subject
 * guard's `listableCampaignWhere` or `sitemapCampaignWhere`, never through
 * the legacy `status` string, which ignores the deadline (CONTEXT.md,
 * Campaign Status; effective-status-listings ticket 02).
 *
 * The same table keeps the other half of the rule in one place: no listing
 * writes the Demo Campaign exclusion itself, so a visitor cannot be shown one
 * by a list that decided differently, and no listing grows a list of Campaign
 * ids or slugs that happen to be fiction today (CONTEXT.md, Demo Campaign;
 * prd-compliance 26).
 *
 * A new public listing belongs in this table, visibly, in the diff.
 */
const PUBLIC_LISTINGS: Record<string, 'listableCampaignWhere' | 'sitemapCampaignWhere'> = {
  'src/app/page.tsx': 'listableCampaignWhere',
  'src/app/explore/[category]/page.tsx': 'listableCampaignWhere',
  'src/app/api/campaigns/route.ts': 'listableCampaignWhere',
  'src/app/api/zakat/campaigns/route.ts': 'listableCampaignWhere',
  'src/app/sitemap.ts': 'sitemapCampaignWhere',
};

const LEGACY_ACTIVE_FILTER = /\bstatus\s*:\s*['"`]active['"`]/;

/**
 * A listing deciding for itself which Campaigns are Demo ones: a boolean, or
 * a filter object. Passing the field through to a card, as
 * `isDemo: campaign.isDemo` does, is not a decision and stays allowed.
 */
const OWN_DEMO_EXCLUSION = /isDemo\s*:\s*(?:true|false|\{)/;

describe('public Campaign listings read the effective status', () => {
  it.each(Object.entries(PUBLIC_LISTINGS))('%s does not filter on the legacy status string', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(LEGACY_ACTIVE_FILTER);
  });

  it.each(Object.entries(PUBLIC_LISTINGS))('%s filters through %s', (file, helper) => {
    expect(readFileSync(file, 'utf8')).toMatch(new RegExp(`\\b${helper}\\(`));
  });
});

describe('public Campaign listings exclude Demo Campaigns through the guard', () => {
  it.each(Object.entries(PUBLIC_LISTINGS))(
    '%s writes no Demo Campaign rule of its own, so the column decides and not a list of Campaigns',
    (file) => {
      expect(readFileSync(file, 'utf8')).not.toMatch(OWN_DEMO_EXCLUSION);
    }
  );
});
