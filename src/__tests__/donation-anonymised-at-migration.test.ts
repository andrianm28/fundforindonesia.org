// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Ticket 36: the `Donation.anonymisedAt` migration, executed against a
 * database that already holds Donations, guest and registered. The CI
 * `migrations` job migrates an EMPTY database, so it cannot show that the
 * column lands on a populated table without disturbing a row: every existing
 * Donation must read `anonymisedAt IS NULL` (none was anonymised), keep its
 * guest contact columns, and keep its amount.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261002190000_donation_anonymised_at';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Donation.anonymisedAt migration against a populated database (ticket 36)', () => {
  if (!DATABASE_URL) {
    console.warn('[donation anonymised-at migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `donation_anonymised_at_${process.pid}`;
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
       VALUES ('u1', 'Fundraiser', 'h1', 'k', 'c1', 'k', now()), ('u2', 'Donor', 'h2', 'k', 'c2', 'k', now())`,
    );
    await db.query(
      `INSERT INTO "Campaign" (id, slug, title, description, story, "coverImage", "targetAmount", category, "creatorId", "updatedAt")
       VALUES ('c1', 'c1', 'T', 'd', 's', 'https://example.com/c.jpg', 1000000, 'x', 'u1', now())`,
    );
    await db.query(
      `INSERT INTO "Donation" (id, amount, "paymentMethod", "campaignId", "donorId", "guestName", "guestEmailHmac",
         "guestEmailHmacKeyId", "guestEmailCiphertext", "guestEmailKeyId")
       VALUES ('d-guest', 50000, 'qris', 'c1', NULL, 'Budi', 'gh', 'k', 'gc', 'k'),
              ('d-registered', 75000, 'qris', 'c1', 'u2', NULL, NULL, NULL, NULL, NULL)`,
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

  it('leaves every existing Donation un-anonymised and otherwise exactly as it was', async () => {
    const { rows } = await db.query(
      `SELECT id, amount, "guestName", "guestEmailHmac", "donorId", "isAnonymous", "anonymisedAt" FROM "Donation" ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: 'd-guest', amount: 50000, guestName: 'Budi', guestEmailHmac: 'gh', donorId: null, isAnonymous: false, anonymisedAt: null },
      { id: 'd-registered', amount: 75000, guestName: null, guestEmailHmac: null, donorId: 'u2', isAnonymous: false, anonymisedAt: null },
    ]);
  });

  it('accepts a timestamp afterwards: the column is nullable and is a timestamp', async () => {
    await db.query(`UPDATE "Donation" SET "anonymisedAt" = now() WHERE id = 'd-guest'`);
    const { rows } = await db.query(`SELECT "anonymisedAt" FROM "Donation" WHERE id = 'd-guest'`);
    expect(rows[0].anonymisedAt).toBeInstanceOf(Date);
  });
});
