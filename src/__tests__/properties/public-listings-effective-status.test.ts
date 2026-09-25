import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Every public list of Campaigns decides what it shows through the subject
 * guard's `listableCampaignWhere` or `sitemapCampaignWhere`, never through
 * the legacy `status` string, which ignores the deadline (CONTEXT.md,
 * Campaign Status; effective-status-listings ticket 02).
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

describe('public Campaign listings read the effective status', () => {
  it.each(Object.entries(PUBLIC_LISTINGS))('%s does not filter on the legacy status string', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(LEGACY_ACTIVE_FILTER);
  });

  it.each(Object.entries(PUBLIC_LISTINGS))('%s filters through %s', (file, helper) => {
    expect(readFileSync(file, 'utf8')).toMatch(new RegExp(`\\b${helper}\\(`));
  });
});
