// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, it, expect } from 'vitest';
import { findCampaignStatusReferences } from '../../tests/support/campaign-status-column-references';

/**
 * The legacy Campaign `status` string is on its way out (spec
 * legacy-status-contract). Nothing reads or writes it any more: every rule
 * uses `lifecycleStatus`, and the column is nullable and ignored until
 * ticket 03 drops it. This guard keeps it that way for application code and
 * for the seed.
 */
const SEED = 'prisma/seed.ts';
const CANARY = 'tests/support/campaign-status-canary.ts';

describe('the legacy Campaign status column', () => {
  let references: string[] = [];

  // Type-checks all of src, which takes a few seconds (more under load).
  beforeAll(() => {
    references = findCampaignStatusReferences({ alsoScan: [SEED, CANARY] });
  }, 120_000);

  it('is named by no src file', () => {
    expect(references.filter((ref) => ref.startsWith('src/'))).toEqual([]);
  });

  it('is named nowhere in the seed', () => {
    expect(references.filter((ref) => ref.startsWith(`${SEED}:`))).toEqual([]);
  });

  // Proves the detector still sees the column: if a change to Prisma's
  // generated types blinded it, the two tests above would pass vacuously.
  it('is still found in the canary that names it on purpose', () => {
    const canaryHits = references.filter((ref) => ref.startsWith(`${CANARY}:`));
    expect(canaryHits).toHaveLength(3);
  });
});

// With the string gone, lifecycleStatus is the only thing that says where a
// seeded Campaign stands, and it defaults to SUBMITTED: an entry that left it
// out would quietly vanish from every public listing. The seed opens Postgres
// at import, so this reads its source (as seed-user-assignments.test.ts does).
describe('the seed', () => {
  it('gives every seeded Campaign an explicit lifecycleStatus', () => {
    const seed = readFileSync(SEED, 'utf8');
    const entries = seed.slice(seed.indexOf('const CAMPAIGNS_DATA'), seed.indexOf('];', seed.indexOf('const CAMPAIGNS_DATA')))
      .split('\n')
      .filter((line) => line.includes('title:'));

    expect(entries).toHaveLength(30);
    for (const entry of entries) expect(entry).toMatch(/lifecycleStatus: CampaignStatus\.[A-Z]+/);
    expect(seed).toContain('lifecycleStatus: campaignData.lifecycleStatus');
  });
});
