import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function backfillSql(): string {
  const dir = "prisma/migrations";
  const match = readdirSync(dir).filter((d) =>
    d.endsWith("_backfill_user_assignments")
  );
  expect(match).toHaveLength(1);
  return readFileSync(join(dir, match[0], "migration.sql"), "utf8");
}

describe("roles backfill migration", () => {
  it("gives ADMIN both assignments", () => {
    const sql = backfillSql();
    expect(sql).toContain(`'VERIFIER' FROM "User" WHERE "role" = 'ADMIN'`);
    expect(sql).toContain(`'ADMIN' FROM "User" WHERE "role" = 'ADMIN'`);
  });

  it("gives MODERATOR the Verifier assignment", () => {
    const sql = backfillSql();
    expect(sql).toContain(`'VERIFIER' FROM "User" WHERE "role" = 'MODERATOR'`);
  });

  it("gives CAMPAIGN_CREATOR and DONOR nothing and never touches the role column", () => {
    const sql = backfillSql();
    expect(sql).not.toContain("CAMPAIGN_CREATOR");
    expect(sql).not.toContain("DONOR");
    expect(sql).not.toMatch(/UPDATE\s+"User"/);
    expect(sql).not.toMatch(/DELETE\s+FROM/);
  });

  it("is re-runnable via ON CONFLICT DO NOTHING", () => {
    const sql = backfillSql();
    expect(sql.match(/ON CONFLICT DO NOTHING/g)).toHaveLength(3);
  });
});
