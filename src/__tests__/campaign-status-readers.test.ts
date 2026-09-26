// @vitest-environment node
import { beforeAll, describe, it, expect } from 'vitest';
import { findCampaignStatusReferences } from '../../tests/support/campaign-status-column-references';

/**
 * The legacy Campaign `status` string is on its way out (spec
 * legacy-status-contract). Nothing reads or writes it any more: every rule
 * uses `lifecycleStatus`, and the column is nullable and ignored until
 * ticket 03 drops it. This guard keeps it that way for application code and
 * for the seed.
 */
const CANARY = 'tests/support/campaign-status-canary.ts';

describe('the legacy Campaign status column', () => {
  let references: string[] = [];

  // Type-checks all of src, which takes a few seconds (more under load).
  beforeAll(() => {
    references = findCampaignStatusReferences({ extraFiles: [CANARY] });
  }, 120_000);

  it('is named by no src file', () => {
    expect(references.filter((ref) => ref.startsWith('src/'))).toEqual([]);
  });

  it('is named nowhere in the seed', () => {
    expect(references.filter((ref) => ref.startsWith('prisma/'))).toEqual([]);
  });

  // Proves the detector still sees the column: if a change to Prisma's
  // generated types blinded it, the two tests above would pass vacuously.
  it('is still found in the canary that names it on purpose', () => {
    const canaryHits = references.filter((ref) => ref.startsWith(`${CANARY}:`));
    expect(canaryHits).toHaveLength(3);
  });
});
