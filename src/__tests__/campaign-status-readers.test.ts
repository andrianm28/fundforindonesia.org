// @vitest-environment node
import { beforeAll, describe, it, expect } from 'vitest';
import { findCampaignStatusReferences } from '../../tests/support/campaign-status-column-references';

/**
 * The legacy Campaign `status` string is on its way out (spec
 * legacy-status-contract). Every reader uses `lifecycleStatus`; the only
 * code still naming the column writes it, so older code reading it keeps
 * working until the column is dropped:
 * - the lifecycle `transition()`, which dual-writes both columns;
 * - Campaign creation, which writes 'pending' next to SUBMITTED.
 * Ticket 02 stops those writes too and empties this list.
 */
const STILL_WRITES_STATUS = ['src/lib/campaign-lifecycle.ts', 'src/app/api/campaigns/route.ts'];

describe('the legacy Campaign status column', () => {
  let references: string[] = [];
  let files: string[] = [];

  // Type-checks all of src, which takes a few seconds (more under load).
  beforeAll(() => {
    references = findCampaignStatusReferences();
    files = Array.from(new Set(references.map((ref) => ref.replace(/:\d+$/, ''))));
  }, 120_000);

  it('is named by no src file outside the ones that still write it', () => {
    const readers = references.filter((ref) => !STILL_WRITES_STATUS.some((file) => ref.startsWith(`${file}:`)));
    expect(readers).toEqual([]);
  });

  // Proves the detector still sees the column: if a change to Prisma's
  // generated types blinded it, the test above would pass vacuously.
  it('is still found in each file that writes it', () => {
    expect(files.sort()).toEqual([...STILL_WRITES_STATUS].sort());
  });
});
