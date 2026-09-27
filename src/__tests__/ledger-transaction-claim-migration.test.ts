// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * The migration behind the ledger's one-claim-per-transaction guarantee
 * (prd-compliance 28b).
 *
 * Two things here are the database's own job, and no unit test opens a
 * database: existing rows have to be numbered so that every transaction
 * written before this migration also owns exactly one claim row, and the
 * index that refuses a second claim has to exist at all. CI proves the
 * migration applies to an empty Postgres and leaves schema.prisma unchanged
 * (the `migrations` job); this reads the statements, so a later edit that
 * drops either fails here first.
 *
 * The third thing is the part that cannot be tested by applying it: whether
 * any database actually holds two transactions under one transactionId. The
 * migration therefore refuses to apply when it finds some, and names them,
 * because a deploy that fails with "duplicate key" and a stack trace tells an
 * operator nothing about which rows to look at.
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

const CLAIM = migrationSql("_ledger_transaction_claim");

describe("the ledger transaction claim migration", () => {
  it("refuses to apply while any transactionId is posted more than once, and names the offenders", () => {
    // A duplicate already in the table is a fact about money that has already
    // moved; this migration cannot decide which of the duplicate sets is the
    // real one, so it stops and says which ids to look at.
    expect(CLAIM).toMatch(/GROUP BY "transactionId"[\s\S]*?HAVING COUNT\(\*\) > 1/);
    expect(CLAIM).toMatch(/RAISE EXCEPTION[\s\S]*?"LedgerEntry"[\s\S]*?transactionId/);
  });

  it("numbers the legs of every transaction that already exists, so old rows are claimed too", () => {
    // Without this the index would only cover transactions posted from here
    // on, and re-posting a transactionId from before the migration would be
    // free: the rows that already carry it would hold no claim.
    expect(CLAIM).toMatch(
      /row_number\(\) OVER \(PARTITION BY "transactionId" ORDER BY "createdAt", id\)/,
    );
    expect(CLAIM).toMatch(/UPDATE "LedgerEntry"[\s\S]*?SET "legIndex"/);
    expect(CLAIM).toContain('ALTER TABLE "LedgerEntry" ALTER COLUMN "legIndex" SET NOT NULL');
  });

  it("makes a transactionId claimable once, by a unique index on the first leg", () => {
    expect(CLAIM).toContain(
      'CREATE UNIQUE INDEX "LedgerEntry_transactionId_claim_key" ON "LedgerEntry"("transactionId") WHERE "legIndex" = 0',
    );
  });

  it("declares legIndex in schema.prisma, required, and says where the index lives", () => {
    // The index is a partial one, which Prisma's schema language cannot
    // express -- the same arrangement as Payment_donationId_paid_key, whose
    // comment in the schema points at the migration for the same reason.
    expect(schema()).toMatch(/model LedgerEntry \{[\s\S]*?legIndex\s+Int\b/);
    expect(schema()).toMatch(/LedgerEntry_transactionId_claim_key/);
  });
});
