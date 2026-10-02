// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Ticket 37: the `20260930110000_volunteer_certificate` migration, executed
 * against a database that already holds Registrations and Payments.
 *
 * It adds two NULLable columns to `Payment` (stored payment instructions) and
 * a new `VolunteerCertificate` table. The CI `migrations` job migrates an
 * EMPTY database, so it cannot show that existing Payment rows survive, nor
 * that the new constraints behave. This builds a throwaway database from every
 * migration before this one, seeds a Trip, Registrations and Payments, applies
 * the migration file, and asserts what Postgres did (docs/agents/verification.md).
 *
 * Needs TEST_DATABASE_URL (CI's `test` job and ci/local.sh set it). Without
 * one every test is skipped and says so.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20260930110000_volunteer_certificate';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('VolunteerCertificate migration against a populated database (ticket 37)', () => {
  if (!DATABASE_URL) {
    console.warn('[volunteer certificate migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `volunteer_certificate_${process.pid}`;
  let db: Client;

  const certificate = (id: string, registrationId: string, code: string) =>
    db.query(
      `INSERT INTO "VolunteerCertificate" (id, "registrationId", code, "volunteerName", "tripTitle", destination,
         "batchStartDate", "batchEndDate", "organizerName")
       VALUES ($1, $2, $3, 'Siti', 'T', 'Sumba', now(), now(), 'Yayasan')`,
      [id, registrationId, code],
    );

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
      `INSERT INTO "Registration" (id, "volunteerId", "batchId", status, "holdExpiresAt", attended, "updatedAt")
       VALUES ('r1', 'u2', 'b1', 'CONFIRMED', now(), true, now()),
              ('r2', 'u2', 'b1', 'CONFIRMED', now(), true, now())`,
    );
    await db.query(
      `INSERT INTO "Payment" (id, "registrationId", provider, method, "providerRef", amount, status, "updatedAt")
       VALUES ('p1', 'r1', 'sumopod', 'qris_redirect', 'ref-1', 1000000, 'PAID', now())`,
    );
    // The migration under test, applied to the populated tables.
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

  it('keeps every existing Payment, with no stored instructions (NULL)', async () => {
    const { rows } = await db.query(`SELECT id, amount, "redirectUrl", "vaNumber" FROM "Payment"`);
    expect(rows).toEqual([{ id: 'p1', amount: 1_000_000, redirectUrl: null, vaNumber: null }]);
  });

  it('stores instructions on a new Payment', async () => {
    await db.query(
      `INSERT INTO "Payment" (id, "registrationId", provider, method, "providerRef", amount, status, "redirectUrl", "updatedAt")
       VALUES ('p2', 'r2', 'sumopod', 'qris_redirect', 'ref-2', 1, 'PENDING', 'https://pay.example/x', now())`,
    );
    const { rows } = await db.query(`SELECT "redirectUrl" FROM "Payment" WHERE id = 'p2'`);
    expect(rows).toEqual([{ redirectUrl: 'https://pay.example/x' }]);
  });

  it('starts with no certificates: nothing is issued retroactively', async () => {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM "VolunteerCertificate"`);
    expect(rows).toEqual([{ n: 0 }]);
  });

  it('refuses a second certificate for one Registration, and a repeated code', async () => {
    await certificate('c1', 'r1', 'code-aaaaaaaaaaaaaaaaaaaa');
    await expect(certificate('c2', 'r1', 'code-bbbbbbbbbbbbbbbbbbbb')).rejects.toThrow(/registrationId/);
    await expect(certificate('c3', 'r2', 'code-aaaaaaaaaaaaaaaaaaaa')).rejects.toThrow(/code/);
  });

  it('refuses a certificate for a Registration that does not exist', async () => {
    await expect(certificate('c4', 'nope', 'code-cccccccccccccccccccc')).rejects.toThrow(/foreign key/);
  });

  it('refuses to delete a Registration that holds a certificate', async () => {
    await expect(db.query(`DELETE FROM "Registration" WHERE id = 'r1'`)).rejects.toThrow(/foreign key|violates/);
  });
});
