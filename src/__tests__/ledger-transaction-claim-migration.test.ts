// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { DuplicateLedgerTransactionError, postTransaction, type LedgerLeg } from "@/lib/money/ledger";
import { isPrismaUniqueConstraintViolation } from "@/lib/prisma-errors";

/**
 * The ledger transaction claim migration (prd-compliance 28b), executed.
 *
 * This file used to assert things about the migration's TEXT -- that a regex
 * for `HAVING COUNT(*) > 1` was somewhere in it, that a `row_number()` window
 * was spelled a particular way. A regex over SQL proves that a string is
 * present, not that Postgres does anything, and it is blind to the way a
 * migration behaves on a database that holds data: an earlier version of this
 * file matched its duplicate-precheck happily while that precheck refused to
 * apply to every ledger with a single posted transaction in it, because it
 * counted ROWS per transactionId and every transaction has two legs by
 * construction. Only a real database can catch that, so there is one here.
 *
 * What it does: builds a scratch schema holding the pre-migration LedgerEntry
 * -- created by replaying this repo's own earlier migrations, not by a
 * hand-written CREATE TABLE -- seeds it with healthy, balanced ledger rows,
 * and runs the migration file against it. Every assertion below is about what
 * the database did, not about what the file says.
 *
 * Needs a Postgres it may create and drop schemas in, named by
 * LEDGER_CLAIM_TEST_DATABASE_URL (see .github/workflows/ci.yml's `migrations`
 * job, and ci/local.sh). Without one every test here is skipped and says so --
 * a skip you can see, which is the honest alternative to a green test that
 * never opened a connection. It is a separate variable from DATABASE_URL on
 * purpose: the rest of the suite must not see a live database.
 */

const DATABASE_URL = process.env.LEDGER_CLAIM_TEST_DATABASE_URL;
const MIGRATIONS_DIR = "prisma/migrations";
const CLAIM_MIGRATION = "_ledger_transaction_claim";
const TIMEOUT = 120_000;

function migrationSql(dir: string): string {
  return readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
}

/**
 * The migrations that have to run before the claim migration, in order.
 *
 * Cut at the claim migration, then trimmed back from the end to the last
 * migration that mentions "LedgerEntry" at all. Everything the claim migration
 * reads -- the table, and the tables its foreign keys point at -- is in that
 * prefix, so the result is the pre-migration LedgerEntry exactly as production
 * has it. The trim is what keeps an unrelated statement out: `pg_trgm` (the
 * duplicate-Campaign hints migration) needs a superuser, and this test has no
 * reason to demand one. A future migration that touches LedgerEntry is picked
 * up by the same search, so this cannot quietly fall behind.
 */
function migrationsBeforeTheClaim(): string[] {
  const dirs = readdirSync(MIGRATIONS_DIR).filter((d) => !d.startsWith("migration_lock")).sort();
  const claimIndex = dirs.findIndex((d) => d.endsWith(CLAIM_MIGRATION));
  expect(claimIndex).toBeGreaterThanOrEqual(0);
  const before = dirs.slice(0, claimIndex);
  const lastLedgerShaped = before
    .map((dir, i) => [dir, i] as const)
    .filter(([dir]) => migrationSql(dir).includes('"LedgerEntry"'))
    .pop();
  expect(lastLedgerShaped).toBeDefined();
  return before.slice(0, lastLedgerShaped![1] + 1);
}

const PRE_MIGRATION_DIRS = migrationsBeforeTheClaim();
const CLAIM_SQL = migrationSql(readdirSync(MIGRATIONS_DIR).find((d) => d.endsWith(CLAIM_MIGRATION))!);
const LATER_LEDGER_ENTRY_COLUMNS = laterLedgerEntryColumns();

/**
 * The `ALTER TABLE "LedgerEntry" ADD COLUMN` statements from migrations AFTER
 * the claim one, and only those, replayed onto the scratch database.
 *
 * The Prisma client driving these tests is the CURRENT one, so it selects every
 * column the current schema declares. A database deliberately stopped at the
 * claim migration does not have the later ones, and the first real query
 * against it fails with P2022 "column does not exist" before the assertion
 * under test is reached. prd-compliance 35 added
 * `LedgerEntry.provider` and `LedgerEntry.providerWithdrawalId` and hit exactly
 * that.
 *
 * Only the column additions are taken, and that is narrow on purpose. The later
 * migrations cannot simply be replayed whole: they build tables and foreign
 * keys this historical database does not have -- the pre-claim history is
 * trimmed back (see migrationsBeforeTheClaim), so `PartnerOrganisation` is not
 * among it -- and one of them wants `pg_trgm`, which needs a superuser this
 * test deliberately does not demand. Taking the column statement on its own is
 * sound because every one of them is nullable and needs no backfill, so it
 * changes nothing about the rows already seeded and nothing about what the
 * claim migration does to them.
 *
 * A later migration that changed LedgerEntry in a way a nullable column-add
 * cannot bridge would need this widened by a human, and would say so by
 * failing with the same P2022.
 */
function laterLedgerEntryColumns(): string {
  const dirs = readdirSync(MIGRATIONS_DIR).filter((d) => !d.startsWith("migration_lock")).sort();
  const claimIndex = dirs.findIndex((d) => d.endsWith(CLAIM_MIGRATION));
  const statements: string[] = [];
  // Array.from rather than spreading or for-of over the match iterator: this
  // repo's tsconfig target predates downlevel iteration, the same reason
  // findUnbalancedTransactions (src/lib/money/ledger.ts) uses Array.from.
  for (const dir of dirs.slice(claimIndex + 1)) {
    const sql = migrationSql(dir);
    if (!sql.includes('"LedgerEntry"')) continue;
    for (const match of Array.from(sql.matchAll(/ALTER TABLE "LedgerEntry" ADD COLUMN[^;]*;/g))) {
      statements.push(match[0]);
    }
  }
  return statements.join("\n");
}

/**
 * The precheck this migration used to open with, verbatim from the draft the
 * independent review rejected. Kept here to be EXECUTED, against healthy data,
 * so the record of why it is gone is a database refusing rather than a
 * paragraph asserting it would have.
 */
const REJECTED_GUARD_SQL = `
DO $$
DECLARE
  duplicate_count BIGINT;
  offenders TEXT;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT "transactionId"
    FROM "LedgerEntry"
    GROUP BY "transactionId"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  SELECT string_agg("transactionId", ', ') INTO offenders
  FROM (
    SELECT "transactionId"
    FROM "LedgerEntry"
    GROUP BY "transactionId"
    HAVING COUNT(*) > 1
    ORDER BY "transactionId"
    LIMIT 20
  ) AS some_offenders;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'LedgerEntry already holds % transactionId(s) posted more than once, e.g. %; this migration applies nothing. Settle which set of entries is the real one, then migrate.',
      duplicate_count,
      offenders;
  END IF;
END $$;
`;

/** The two transactions seeded before every test: healthy, balanced, ordinary. */
const SEED: Array<{ id: string; transactionId: string; legIndex: number; account: string; direction: string; amount: number; at: string }> = [
  { id: "e1", transactionId: "webhook:mid:evt-1", legIndex: 0, account: "GATEWAY_CLEARING", direction: "DEBIT", amount: 100_000, at: "2026-09-01 10:00:00" },
  { id: "e2", transactionId: "webhook:mid:evt-1", legIndex: 1, account: "ESCROW_HOLD", direction: "CREDIT", amount: 97_000, at: "2026-09-01 10:00:01" },
  { id: "e3", transactionId: "webhook:mid:evt-1", legIndex: 2, account: "PROVIDER_FEE", direction: "CREDIT", amount: 3_000, at: "2026-09-01 10:00:02" },
  { id: "e4", transactionId: "payout-instructed-payout-1", legIndex: 0, account: "CAMPAIGN_BALANCE", direction: "DEBIT", amount: 40_000, at: "2026-09-01 11:00:00" },
  { id: "e5", transactionId: "payout-instructed-payout-1", legIndex: 1, account: "PAYOUT_CLEARING", direction: "CREDIT", amount: 40_000, at: "2026-09-01 11:00:01" },
];

async function seedLedger(client: Client): Promise<void> {
  for (const leg of SEED) {
    await client.query(
      `INSERT INTO "LedgerEntry" ("id", "account", "direction", "amount", "transactionId", "createdAt")
       VALUES ($1, $2::"LedgerAccount", $3::"LedgerDirection", $4, $5, $6)`,
      [leg.id, leg.account, leg.direction, leg.amount, leg.transactionId, leg.at],
    );
  }
}

function databaseUrlFor(database: string): string {
  // Prisma's own `?schema=` parameter is not one `pg` understands, and the
  // scratch database is a plain one, so every query parameter is dropped.
  const [base] = DATABASE_URL!.split("?");
  return `${base.substring(0, base.lastIndexOf("/") + 1)}${database}`;
}

let databaseCounter = 0;

/**
 * A throwaway database, migrated to just before the claim migration and seeded.
 *
 * One per test, dropped afterwards: a migration test that shares a database
 * with its neighbours is a test whose result depends on what ran before it. A
 * whole database rather than a schema, so the Prisma client below resolves the
 * same `public` it resolves everywhere else.
 */
async function withPreMigrationLedger(
  body: (ctx: { client: Client; url: string }) => Promise<void>,
): Promise<void> {
  const database = `ledger_claim_${process.pid}_${databaseCounter++}`;
  const url = databaseUrlFor(database);
  const admin = new Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const dir of PRE_MIGRATION_DIRS) {
      await client.query(migrationSql(dir));
    }
    // Applied before the seed rather than inside the body, because the client
    // has to be able to read the table from the first statement onward, and
    // because a nullable column-add disturbs neither the seed nor anything the
    // claim migration goes on to do.
    if (LATER_LEDGER_ENTRY_COLUMNS) {
      await client.query(LATER_LEDGER_ENTRY_COLUMNS);
    }
    await seedLedger(client);
    await body({ client, url });
  } finally {
    await client.end();
    // WITH (FORCE) closes any session a client left behind, which a plain
    // DROP DATABASE refuses to do.
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  }
}

function claimRows(client: Client): Promise<{ transactionId: string; legIndex: number }[]> {
  return client
    .query<{ transactionId: string; legIndex: number }>(
      `SELECT "transactionId", "legIndex" FROM "LedgerEntry" ORDER BY "transactionId", "legIndex"`,
    )
    .then((r) => r.rows);
}

describe.skipIf(!DATABASE_URL)("the ledger transaction claim migration, applied to a database with rows in it", () => {
  if (!DATABASE_URL) {
    console.warn(
      "[ledger claim migration] LEDGER_CLAIM_TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. " +
        "CI's `migrations` job sets it; ci/local.sh does too.",
    );
  }

  it("applies to a ledger that already holds healthy transactions", async () => {
    await withPreMigrationLedger(async ({ client }) => {
      // The whole point, and the thing no regex could have shown: this is what
      // a real pre-migration database looks like, and the migration runs on it.
      await expect(client.query(CLAIM_SQL)).resolves.toBeDefined();
      // ... and the rows are all still there, numbered.
      expect((await claimRows(client)).map((r) => [r.transactionId, r.legIndex])).toEqual([
        ["payout-instructed-payout-1", 0],
        ["payout-instructed-payout-1", 1],
        ["webhook:mid:evt-1", 0],
        ["webhook:mid:evt-1", 1],
        ["webhook:mid:evt-1", 2],
      ]);
    });
  }, TIMEOUT);

  it("is refused by the precheck it used to carry, on exactly this healthy data", async () => {
    await withPreMigrationLedger(async ({ client }) => {
      // The blocker, executed. Both seeded transactions are ordinary and
      // balanced, and both have more than one row -- so the precheck counts
      // them as duplicates and takes the whole deploy with it, against a
      // database with nothing wrong in it. That is why the precheck is gone
      // rather than rewritten: no statement in the table can tell "posted
      // twice" from "posted once, with more legs", because before this
      // migration a row carries nothing that says which posting it belongs to.
      let error: unknown;
      try {
        await client.query(REJECTED_GUARD_SQL);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toMatch(/holds 2 transactionId\(s\) posted more than once/);
      // And it stopped the migration dead: the column it would have added is
      // not there.
      await expect(
        client.query(`SELECT "legIndex" FROM "LedgerEntry"`),
      ).rejects.toThrow(/column .*legIndex.* does not exist/);
    });
  }, TIMEOUT);

  it("claims history, so a transactionId posted before the migration cannot be posted again", async () => {
    await withPreMigrationLedger(async ({ client }) => {
      await client.query(CLAIM_SQL);

      // Exactly one leg 0 per transaction, whatever the leg count: the claim
      // is per transaction, not per entry. Ordering comes from createdAt, so
      // the first leg written is the one that claims it.
      const claims = await client.query<{ transactionId: string; claims: number; legs: number }>(
        `SELECT "transactionId", (COUNT(*) FILTER (WHERE "legIndex" = 0))::int AS claims, COUNT(*)::int AS legs
         FROM "LedgerEntry" GROUP BY "transactionId" ORDER BY "transactionId"`,
      );
      expect(claims.rows).toEqual([
        { transactionId: "payout-instructed-payout-1", claims: 1, legs: 2 },
        { transactionId: "webhook:mid:evt-1", claims: 1, legs: 3 },
      ]);

      // Re-posting what was already posted before the migration: refused by
      // the index, not by a read.
      await expect(
        client.query(
          `INSERT INTO "LedgerEntry" ("id", "account", "direction", "amount", "transactionId", "legIndex", "createdAt")
           VALUES ('repost', 'GATEWAY_CLEARING', 'DEBIT', 100000, 'webhook:mid:evt-1', 0, now())`,
        ),
      ).rejects.toThrow(/LedgerEntry_transactionId_claim_key/);
    });
  }, TIMEOUT);

  it("refuses a second claim of a transactionId, and only the claim", async () => {
    await withPreMigrationLedger(async ({ client }) => {
      await client.query(CLAIM_SQL);

      // A second leg 0 on the same id: refused, by name.
      await expect(
        client.query(
          `INSERT INTO "LedgerEntry" ("id", "account", "direction", "amount", "transactionId", "legIndex", "createdAt")
           VALUES ('dupe', 'GATEWAY_CLEARING', 'DEBIT', 5000, 'webhook:mid:evt-1', 0, now())`,
        ),
      ).rejects.toThrow(/LedgerEntry_transactionId_claim_key/);

      // The other legs of a transaction are untouched by the index, and a
      // different transactionId still posts normally -- this is one claim per
      // transaction, not one entry per transaction. (The extra leg below does
      // unbalance that transaction; balancing is postTransaction's job, not
      // the index's, and nothing here is about it.)
      await expect(
        client.query(
          `INSERT INTO "LedgerEntry" ("id", "account", "direction", "amount", "transactionId", "legIndex", "createdAt")
           VALUES ('new-leg', 'PLATFORM_FEE', 'DEBIT', 5000, 'webhook:mid:evt-1', 1, now())`,
        ),
      ).resolves.toBeDefined();
      await expect(
        client.query(
          `INSERT INTO "LedgerEntry" ("id", "account", "direction", "amount", "transactionId", "legIndex", "createdAt")
           VALUES ('fresh', 'GATEWAY_CLEARING', 'DEBIT', 5000, 'webhook:mid:other', 0, now())`,
        ),
      ).resolves.toBeDefined();
    });
  }, TIMEOUT);

  it("leaves exactly one transaction behind when the same id is posted concurrently", async () => {
    await withPreMigrationLedger(async ({ client, url }) => {
      await client.query(CLAIM_SQL);

      // Two real connections, in two real transactions, inserting the same
      // claim at the same time. The second one BLOCKS on the uncommitted index
      // entry rather than being told immediately -- which is the part a fake
      // transaction client cannot show -- and when the first commits, the
      // second's whole multi-row statement fails and takes its other leg with
      // it. One transaction survives; the loser wrote nothing at all.
      const winner = new Client({ connectionString: url });
      const loser = new Client({ connectionString: url });
      await winner.connect();
      await loser.connect();
      const insert = (id: string) =>
        `INSERT INTO "LedgerEntry" ("id", "account", "direction", "amount", "transactionId", "legIndex", "createdAt")
         VALUES ('${id}-debit', 'GATEWAY_CLEARING', 'DEBIT', 100000, 'race-1', 0, now()),
                ('${id}-credit', 'PAYOUT_CLEARING', 'CREDIT', 100000, 'race-1', 1, now())`;
      try {
        await winner.query("BEGIN");
        await winner.query(insert("winner"));
        await loser.query("BEGIN");
        const loserInsert = loser.query(insert("loser")).then(
          () => ({ ok: true as const }),
          (err: Error) => ({ ok: false as const, err }),
        );
        // Still blocked: the winner has not committed, so the index has
        // nothing to refuse the loser on yet.
        await new Promise((r) => setTimeout(r, 250));
        const pending = await Promise.race([loserInsert, Promise.resolve("still-blocked" as const)]);
        expect(pending).toBe("still-blocked");
        await winner.query("COMMIT");

        const outcome = await loserInsert;
        expect(outcome.ok).toBe(false);
        expect((outcome as { err: Error }).err.message).toMatch(/LedgerEntry_transactionId_claim_key/);
      } finally {
        await Promise.allSettled([winner.query("ROLLBACK"), loser.query("ROLLBACK")]);
        await Promise.all([winner.end(), loser.end()]);
      }

      // The loser's statement was all-or-nothing: its non-claiming leg is not
      // in the table either, so no half-transaction is left describing money
      // that never moved.
      const raceRows = (await claimRows(client)).filter((r) => r.transactionId === "race-1");
      expect(raceRows.map((r) => r.legIndex)).toEqual([0, 1]);
      expect((await client.query(`SELECT COUNT(*)::int AS n FROM "LedgerEntry" WHERE id LIKE 'loser%'`)).rows[0].n).toBe(0);
    });
  }, TIMEOUT);

  it("re-runs cleanly, because Prisma does not wrap a migration in a transaction", async () => {
    await withPreMigrationLedger(async ({ client }) => {
      await client.query(CLAIM_SQL);
      const afterFirst = await claimRows(client);

      // There is no BEGIN/COMMIT in the file and `prisma migrate deploy` does
      // not add one, so a failure part-way leaves the earlier statements
      // applied and the migration unrecorded. Every statement is therefore
      // re-runnable: this second pass is what an operator gets after a partial
      // application, and it must not fail on a column or index that already
      // exists -- nor renumber anything.
      await expect(client.query(CLAIM_SQL)).resolves.toBeDefined();
      expect(await claimRows(client)).toEqual(afterFirst);
    });
  }, TIMEOUT);

  describe("and the code that has to hear about it", () => {
    const prismaClients: PrismaClient[] = [];

    afterAll(async () => {
      await Promise.all(prismaClients.map((c) => c.$disconnect()));
    });

    function prismaFor(url: string): PrismaClient {
      const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      prismaClients.push(client);
      return client;
    }

    // Platform-level accounts only, so the fixture needs no Campaign row to
    // point its subject at: this is about the claim, not about subjects.
    const BALANCED: LedgerLeg[] = [
      { account: "GATEWAY_CLEARING", direction: "DEBIT", amount: 100_000 },
      { account: "PAYOUT_CLEARING", direction: "CREDIT", amount: 100_000 },
    ];

    it("turns the database's own refusal into a duplicate, and loses nothing", async () => {
      await withPreMigrationLedger(async ({ client, url }) => {
        // The generated client knows about legIndex, so the database has to
        // be the migrated one -- which is also the state every deployment
        // reaches.
        await client.query(CLAIM_SQL);
        const prisma = prismaFor(url);
        const post = () => prisma.$transaction((tx) => postTransaction(tx, BALANCED, { transactionId: "evt-1" }));

        expect(await post()).toBe("evt-1");
        // A real P2002 from a real partial index, not a hand-built error
        // object: this is the error Prisma actually raises, so the mapping in
        // postTransaction is checked against the thing it will meet.
        await expect(post()).rejects.toThrow(DuplicateLedgerTransactionError);
        await expect(post()).rejects.toMatchObject({ transactionId: "evt-1" });
        // Still one transaction, both legs: a refusal must never mean posting
        // it twice, and must never leave half of one behind.
        const rows = await prisma.ledgerEntry.findMany({
          where: { transactionId: "evt-1" },
          orderBy: { legIndex: "asc" },
        });
        expect(rows.map((r) => r.legIndex)).toEqual([0, 1]);
        // And the ledger still balances, so a retry storm cannot unbalance it.
        const totals = await prisma.ledgerEntry.groupBy({
          by: ["direction"],
          where: { transactionId: "evt-1" },
          _sum: { amount: true },
        });
        // Keyed, not compared in order: groupBy promises no ordering.
        expect(Object.fromEntries(totals.map((t) => [t.direction, t._sum.amount]))).toEqual({
          DEBIT: 100_000,
          CREDIT: 100_000,
        });
      });
    }, TIMEOUT);

    it("raises an error whose shape the code above was written against", async () => {
      await withPreMigrationLedger(async ({ client, url }) => {
        await client.query(CLAIM_SQL);
        const prisma = prismaFor(url);
        const legs = BALANCED.map((leg, legIndex) => ({
          account: leg.account,
          direction: leg.direction,
          amount: leg.amount,
          transactionId: "evt-2",
          legIndex,
        }));

        await prisma.ledgerEntry.createMany({ data: legs });
        // Caught here rather than through postTransaction, so the error
        // itself is visible: this is the object the duplicate is recognised
        // from, and it is the shape the fake in ledger.test.ts imitates.
        const error = await prisma.ledgerEntry
          .createMany({ data: legs })
          .then(() => null)
          .catch((err: unknown) => err);
        expect(error).not.toBeNull();
        expect(isPrismaUniqueConstraintViolation(error)).toBe(true);
        // Prisma 7 over the pg driver adapter names the index under the
        // adapter's own nesting and reports no `target` at all -- which is
        // why the predicate above matches on `code` alone.
        expect(error).toMatchObject({
          code: "P2002",
          meta: { driverAdapterError: { cause: { constraint: { index: "LedgerEntry_transactionId_claim_key" } } } },
        });
        expect((error as { meta: { target?: unknown } }).meta.target).toBeUndefined();
      });
    }, TIMEOUT);
  });
});

describe("the schema agrees with the migration", () => {
  it("declares legIndex, required, and points at the index it cannot express", () => {
    // The one thing here that is a text assertion rather than an executed
    // one, and deliberately: a partial index is not expressible in Prisma's
    // schema language, so schema.prisma and the migration have to agree by
    // hand -- and CI's `migrations` job is what proves they agree, by
    // diffing the migrated database against the schema.
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toMatch(/model LedgerEntry \{[\s\S]*?legIndex\s+Int\b/);
    expect(schema).toContain("LedgerEntry_transactionId_claim_key");
  });
});
