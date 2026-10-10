import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Whether a visitor sees Demo Campaigns can depend on the data: with
 * SHOW_DEMO_CAMPAIGNS=auto they go once a real Campaign is Active (rilis-1
 * 91), which takes a read. So the two catalogue guards return a Promise, and
 * a caller that forgets `await` and spreads it into a `where` gets no filter
 * at all: Drafts and Demo Campaigns in a public list, with TypeScript silent.
 * This pins every call in application code to an `await`.
 */
const ASYNC_CATALOGUE_GUARDS = /\b(listableCampaignWhere|catalogueDemoWhere)\(/;
const AWAITED_OR_DEFINED = /(?:\bawait\s+|\bfunction\s+)(?:listableCampaignWhere|catalogueDemoWhere)\(/;

function applicationFiles(dir = 'src'): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return full === join('src', 'generated') ? [] : applicationFiles(full);
    return /\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : [];
  });
}

/** The lines of a file that are code: a comment may name the guards without calling them. */
function codeLines(file: string): Array<{ text: string; number: number }> {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter(({ text }) => !/^(\*|\/\/|\/\*)/.test(text));
}

describe('the catalogue guards that read the database are awaited', () => {
  it('no application file calls listableCampaignWhere or catalogueDemoWhere without await', () => {
    const unawaited = applicationFiles().flatMap((file) =>
      codeLines(file)
        .filter(({ text }) => ASYNC_CATALOGUE_GUARDS.test(text) && !AWAITED_OR_DEFINED.test(text))
        .map(({ number }) => `${file}:${number}`)
    );

    expect(unawaited).toEqual([]);
  });
});

/**
 * Only the public catalogue follows SHOW_DEMO_CAMPAIGNS (CONTEXT.md, Demo
 * Campaign): the Campaign lists and Prayer Wall a visitor reads, the subject
 * guard that decides, and an Admin screen that asks for every Campaign. Money,
 * Impact, abuse, dormant balances, reminders, the sitemap, Donation and Payout
 * refusal read `isDemo` or `NOT_A_DEMO_CAMPAIGN` and never the decision, so no
 * value of the switch, `auto` included, can change them (rilis-1 91).
 *
 * The allowlist is a literal: a new reader of the decision is a reviewer's
 * call, made in this diff.
 */
const CATALOGUE_DECISION_READERS = [
  'src/app/api/campaigns/route.ts',
  'src/app/api/prayers/route.ts',
  'src/app/api/zakat/campaigns/route.ts',
  'src/app/explore/[category]/page.tsx',
  'src/app/page.tsx',
  'src/components/collecting-entity/AssignCollectingEntityScreen.tsx',
  'src/lib/subject-guard.ts',
];
const ASKS_THE_DECISION = /\b(showDemoCampaigns|catalogueDemoWhere|listableCampaignWhere|SHOW_DEMO_CAMPAIGNS)\b/;

describe('only the public catalogue follows SHOW_DEMO_CAMPAIGNS', () => {
  it('no other application file asks whether Demo Campaigns are shown', () => {
    const readers = applicationFiles().filter((file) => codeLines(file).some(({ text }) => ASKS_THE_DECISION.test(text)));

    expect(readers.sort()).toEqual([...CATALOGUE_DECISION_READERS].sort());
  });
});
