// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Every GET under /api/campaigns/[slug]/ answers for a Campaign, so it must
 * judge that Campaign by the visibility rule (CONTEXT.md, Campaign Status;
 * src/lib/campaign-visibility.ts) before it says anything about it: an
 * unapproved Campaign does not exist for anyone but its Fundraiser,
 * Verifiers and Admins. A GET added later that skips the rule fails here.
 *
 * A route passes by calling mayViewCampaign itself or findViewableCampaign
 * (src/lib/campaign-visibility-route.ts), which calls it.
 */
const ROOT = join(__dirname);

// GETs that answer only to an already-privileged caller (and so never leak
// a Campaign to the public) may be listed here, each with its reason.
const EXEMPT: Record<string, string> = {};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [path] : [];
  });
}

const EXPORTS_GET = /export\s+(async\s+function\s+GET\b|const\s+GET\b|\{[^}]*\bGET\b[^}]*\})/;
const CONSULTS_RULE = /\b(mayViewCampaign|findViewableCampaign)\s*\(/;

const getRoutes = routeFiles(ROOT)
  .filter((file) => EXPORTS_GET.test(readFileSync(file, 'utf8')))
  .map((file) => relative(ROOT, file));

describe('every GET under /api/campaigns/[slug]/', () => {
  it('is found (the scan is not vacuous)', () => {
    expect(getRoutes).toEqual(
      expect.arrayContaining([
        'route.ts',
        'updates/route.ts',
        'donations/route.ts',
        'disbursements/route.ts',
      ])
    );
  });

  it.each(getRoutes.filter((route) => !(route in EXEMPT)))(
    '%s consults the Campaign visibility rule',
    (route) => {
      expect(readFileSync(join(ROOT, route), 'utf8')).toMatch(CONSULTS_RULE);
    }
  );
});
