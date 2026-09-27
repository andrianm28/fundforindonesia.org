// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * The migration behind duplicate hints (prd-compliance 14, PRD FFI-05).
 *
 * Two things here are invisible to the unit tests, because they are the
 * database's own job and no unit test opens a database: the trigram extension
 * has to exist before `similarity()` can be called at all, and the "bukan
 * duplikat" item has to be seeded as an ordinary checklist row for every
 * environment to get one. CI proves the migration applies to an empty Postgres
 * and leaves schema.prisma unchanged (the `migrations` job); this reads the
 * statements so a later edit that drops either of those fails here first.
 */

const MIGRATION_DIR = "prisma/migrations";

function migrationSql(suffix: string): string {
  const match = readdirSync(MIGRATION_DIR).filter((d) => d.endsWith(suffix));
  expect(match).toHaveLength(1);
  return readFileSync(join(MIGRATION_DIR, match[0], "migration.sql"), "utf8");
}

function schema(): string {
  return readFileSync("prisma/schema.prisma", "utf8");
}

const DUPLICATE_HINTS = migrationSql("_duplicate_campaign_hints");

describe("the duplicate hints migration", () => {
  it("enables pg_trgm if the database has not got it, and does not mind if it has", () => {
    expect(DUPLICATE_HINTS).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  });

  it("indexes the title for trigram lookups, in the migration and in the schema alike", () => {
    // The same index, under the name Prisma itself derives from the field:
    // CI's migrations job fails when the two disagree, since `migrate diff`
    // would find an index the schema does not declare.
    expect(DUPLICATE_HINTS).toContain('CREATE INDEX "Campaign_title_idx" ON "Campaign" USING GIN ("title" gin_trgm_ops)');
    expect(schema()).toContain("gin_trgm_ops");
  });

  it("indexes the beneficiary name for the exact match, in the migration and in the schema alike", () => {
    expect(DUPLICATE_HINTS).toContain('CREATE INDEX "Campaign_beneficiaryName_idx" ON "Campaign"("beneficiaryName")');
    expect(schema()).toContain("@@index([beneficiaryName])");
  });

  it("adds the beneficiary name as a nullable plaintext column, never an encrypted one", () => {
    // ADR 0012 keeps names plaintext so they stay comparable; a ciphertext
    // here would make "identical beneficiary name" unanswerable.
    expect(DUPLICATE_HINTS).toContain('ALTER TABLE "Campaign" ADD COLUMN "beneficiaryName" TEXT;');
    expect(schema()).toMatch(/beneficiaryName\s+String\?/);
  });

  it("creates the Admin's similarity threshold as append-only rows, with who set it and when", () => {
    expect(DUPLICATE_HINTS).toMatch(
      /CREATE TABLE "DuplicateSimilarityThreshold" \([\s\S]*"threshold" DOUBLE PRECISION NOT NULL[\s\S]*"setById" TEXT NOT NULL[\s\S]*"setAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/,
    );
    // The Admin who set a row is a real User, held by a foreign key: a
    // threshold nobody can be named against is not an audit trail.
    expect(DUPLICATE_HINTS).toContain(
      'ADD CONSTRAINT "DuplicateSimilarityThreshold_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT',
    );
    expect(schema()).toMatch(/model DuplicateSimilarityThreshold \{[\s\S]*setById\s+String/);
  });

  it("seeds the not-a-duplicate checklist item as a required general item, past whatever the Admin already added", () => {
    // kind NULL is the "Semua" row (PRD §7.1), so every Kind's submission
    // snapshots it and the Verifier's tick travels with the request.
    expect(DUPLICATE_HINTS).toMatch(/'bukan-duplikat'[\s\S]*?, true, true, NULL/);
    expect(DUPLICATE_HINTS).toContain("MAX(position)");
  });
});
