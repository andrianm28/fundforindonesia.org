// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Ticket 35: the `Registration.attended` migration, executed against a
 * database that already holds Registrations.
 *
 * `ADD COLUMN ... NOT NULL DEFAULT false` is only safe on a populated table
 * because of the DEFAULT, and the CI `migrations` job migrates an EMPTY
 * database, so it cannot show that. This builds a throwaway database from
 * every migration before this one, seeds Registrations in each status, runs
 * the migration file, and asserts what Postgres did: every existing row reads
 * `attended = false`, the column refuses NULL, and a new row defaults to false
 * (docs/agents/verification.md: a migration's behaviour is a property of a
 * database, so it is tested against one).
 *
 * Needs a Postgres it may create and drop databases in, named by
 * TEST_DATABASE_URL (CI's `test` job sets it; ci/local.sh does too). Without
 * one every test is skipped and says so, a skip you can see rather than a
 * green check that never opened a connection.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20260930100000_registration_attended';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Registration.attended migration against a populated database (ticket 35)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[registration attended migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.',
    );
  }

  const databaseName = `registration_attended_${process.pid}`;
  let db: Client;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();

    db = new Client({ connectionString: databaseUrlFor(databaseName) });
    await db.connect();

    expect(allDirs()).toContain(THIS_MIGRATION);
    for (const dir of allDirs().filter((d) => d < THIS_MIGRATION)) await db.query(sqlOf(dir));

    await db.query(
      `INSERT INTO "User" (id, name, "emailHmac", "emailHmacKeyId", "emailCiphertext", "emailKeyId", "updatedAt")
       VALUES ('u1', 'Fundraiser', 'h1', 'k', 'c1', 'k', now()), ('u2', 'Volunteer', 'h2', 'k', 'c2', 'k', now())`,
    );
    await db.query(
      `INSERT INTO "VolunteerTrip" (id, slug, title, description, story, "coverImage", destination, itinerary,
         "tripFeeAmount", "fundraiserId", "updatedAt")
       VALUES ('t1', 't1', 'T', 'd', 's', 'https://example.com/c.jpg', 'Sumba', 'i', 1000000, 'u1', now())`,
    );
    await db.query(
      `INSERT INTO "VolunteerBatch" (id, "tripId", "startDate", "endDate", "registrationDeadline", "maxQuota",
         "minQuota", "updatedAt")
       VALUES ('b1', 't1', now(), now(), now(), 10, 2, now())`,
    );
    await db.query(
      `INSERT INTO "Registration" (id, "volunteerId", "batchId", status, "holdExpiresAt", "updatedAt")
       VALUES ('r-hold', 'u2', 'b1', 'HOLD', now(), now()),
              ('r-confirmed', 'u2', 'b1', 'CONFIRMED', now(), now()),
              ('r-cancelled', 'u2', 'b1', 'CANCELLED', now(), now())`,
    );
    // The migration under test, applied to the populated table.
    await db.query(sqlOf(THIS_MIGRATION));
  }, 180_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await db?.end();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  it('gives every existing Registration attended = false, whatever its status', async () => {
    const { rows } = await db.query(`SELECT id, attended FROM "Registration" ORDER BY id`);
    expect(rows).toEqual([
      { id: 'r-cancelled', attended: false },
      { id: 'r-confirmed', attended: false },
      { id: 'r-hold', attended: false },
    ]);
  });

  it('defaults a Registration inserted afterwards to false', async () => {
    await db.query(
      `INSERT INTO "Registration" (id, "volunteerId", "batchId", status, "holdExpiresAt", "updatedAt")
       VALUES ('r-new', 'u2', 'b1', 'HOLD', now(), now())`,
    );
    const { rows } = await db.query(`SELECT attended FROM "Registration" WHERE id = 'r-new'`);
    expect(rows).toEqual([{ attended: false }]);
  });

  it('refuses NULL: the column is NOT NULL', async () => {
    await expect(db.query(`UPDATE "Registration" SET attended = NULL WHERE id = 'r-hold'`)).rejects.toThrow(
      /null value in column "attended"/,
    );
  });
});
