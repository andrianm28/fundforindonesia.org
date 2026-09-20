import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function lifecycleMigrationSql(): string {
  const dir = "prisma/migrations";
  const match = readdirSync(dir).filter((d) =>
    d.endsWith("_add_campaign_lifecycle")
  );
  expect(match).toHaveLength(1);
  return readFileSync(join(dir, match[0], "migration.sql"), "utf8");
}

describe("campaign lifecycle backfill migration", () => {
  it("adds the column with the SUBMITTED default", () => {
    const sql = lifecycleMigrationSql();
    expect(sql).toContain(
      'ADD COLUMN "lifecycleStatus" "CampaignStatus" NOT NULL DEFAULT \'SUBMITTED\''
    );
  });

  it("backfills all six legacy strings to their enum values", () => {
    const sql = lifecycleMigrationSql();
    expect(sql).toContain(
      `"lifecycleStatus" = 'SUBMITTED' WHERE "status" = 'pending'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'ACTIVE' WHERE "status" = 'active'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'REJECTED' WHERE "status" = 'rejected'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'SUSPENDED' WHERE "status" = 'suspended'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'COMPLETED' WHERE "status" = 'completed'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'EXPIRED' WHERE "status" = 'expired'`
    );
  });

  it("never drops or alters the legacy string column", () => {
    const sql = lifecycleMigrationSql();
    expect(sql).not.toContain('DROP COLUMN "status"');
    expect(sql).not.toContain('ALTER COLUMN "status"');
  });
});
