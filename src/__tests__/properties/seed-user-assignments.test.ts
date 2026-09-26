import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Ticket 06's ledger left an explicit, named gap: prisma/seed.ts did not
 * write UserAssignment rows, so a fresh-seeded DB left ADMIN/MODERATOR
 * without assignments while a migrated DB had them (from
 * prisma/migrations/20260920160016_backfill_user_assignments/migration.sql).
 * Harmless while nothing reads assignments yet -- but ticket 07 starts
 * reading them, so fresh and migrated environments must not diverge.
 *
 * This pins the seed to the exact same mapping the backfill migration uses:
 * ADMIN gains both VERIFIER and ADMIN, MODERATOR gains VERIFIER only.
 *
 * seed.ts cannot be executed in this test process -- it opens a real
 * Postgres connection at module scope via PrismaPg -- so, matching the
 * existing precedent for this file
 * (src/__tests__/properties/campaign-writers.test.ts's
 * "the seed sets each Campaign's lifecycleStatus" case), this asserts against the source
 * text rather than running it.
 */
describe("seed backfills UserAssignment rows", () => {
  const source = readFileSync("prisma/seed.ts", "utf8");

  it("writes assignments idempotently, matching the backfill migration's ON CONFLICT DO NOTHING", () => {
    expect(source).toContain("userAssignment.createMany");
    expect(source).toContain("skipDuplicates: true");
  });

  it("gives ADMIN both assignments", () => {
    expect(source).toMatch(/admins\.map\([^)]*Assignment\.VERIFIER/);
    expect(source).toMatch(/admins\.map\([^)]*Assignment\.ADMIN/);
  });

  it("gives MODERATOR the Verifier assignment only", () => {
    expect(source).toMatch(/moderators\.map\([^)]*Assignment\.VERIFIER/);
    expect(source).not.toMatch(/moderators\.map\([^)]*Assignment\.ADMIN/);
  });
});
