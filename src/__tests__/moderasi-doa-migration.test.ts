// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * PKS pemenuhan 10: the Prayer moderation columns, applied to a database that
 * already holds Prayers. Every existing Prayer must stay on the public lists
 * (hidden = false, no deletion), and the new row default must be the same.
 * The CI `migrations` job migrates an EMPTY database, so it cannot show it.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261111100000_moderasi_doa';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Prayer moderation migration against a populated database (PKS 3.7c)', () => {
  if (!DATABASE_URL) {
    console.warn('[moderasi doa migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `moderasi_doa_${process.pid}`;
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
       VALUES ('u1', 'Fundraiser', 'h1', 'k', 'c1', 'k', now())`,
    );
    await db.query(
      `INSERT INTO "Campaign" (id, slug, title, description, story, "coverImage", "targetAmount", category, "creatorId", "updatedAt")
       VALUES ('c1', 'c1', 'C', 'd', 's', 'https://example.com/c.jpg', 1000000, 'kesehatan', 'u1', now())`,
    );
    await db.query(
      `INSERT INTO "Donation" (id, amount, "paymentMethod", "campaignId")
       VALUES ('d1', 10000, 'qris', 'c1'), ('d2', 20000, 'qris', 'c1')`,
    );
    await db.query(
      `INSERT INTO "Prayer" (id, text, "donationId", "campaignId")
       VALUES ('p1', 'doa satu', 'd1', 'c1')`,
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

  it('leaves every existing Prayer visible and undeleted, with no moderator on record', async () => {
    const { rows } = await db.query(
      `SELECT hidden, "hiddenAt", "hiddenById", "deletedAt", "deletedById" FROM "Prayer" WHERE id = 'p1'`,
    );
    expect(rows).toEqual([{ hidden: false, hiddenAt: null, hiddenById: null, deletedAt: null, deletedById: null }]);
  });

  it('defaults a Prayer written afterwards to visible, and refuses hidden = NULL', async () => {
    await db.query(`INSERT INTO "Prayer" (id, text, "donationId", "campaignId") VALUES ('p2', 'doa dua', 'd2', 'c1')`);
    const { rows } = await db.query(`SELECT hidden FROM "Prayer" WHERE id = 'p2'`);
    expect(rows).toEqual([{ hidden: false }]);
    await expect(db.query(`UPDATE "Prayer" SET hidden = NULL WHERE id = 'p2'`)).rejects.toThrow(
      /null value in column "hidden"/,
    );
  });

  it('keeps the moderator record when the moderator account is deleted (no foreign key)', async () => {
    await db.query(`INSERT INTO "User" (id, name, "emailHmac", "emailHmacKeyId", "emailCiphertext", "emailKeyId", "updatedAt")
      VALUES ('mod1', 'Mod', 'h2', 'k', 'c2', 'k', now())`);
    await db.query(`UPDATE "Prayer" SET hidden = true, "hiddenAt" = now(), "hiddenById" = 'mod1' WHERE id = 'p1'`);
    await db.query(`DELETE FROM "User" WHERE id = 'mod1'`);
    const { rows } = await db.query(`SELECT "hiddenById" FROM "Prayer" WHERE id = 'p1'`);
    expect(rows).toEqual([{ hiddenById: 'mod1' }]);
  });
});
