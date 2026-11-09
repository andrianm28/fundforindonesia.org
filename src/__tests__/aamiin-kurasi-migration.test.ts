// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * PKS pemenuhan 15: the Aamiin mark table and the home curation tables,
 * applied to a database that already holds Prayers and Campaigns. The unique
 * key is what makes "one Aamiin per (Prayer, marker)" true under a race, so it
 * is exercised here with the very statement the route's `skipDuplicates`
 * becomes (INSERT ... ON CONFLICT DO NOTHING), on two connections at once.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261111150000_aamiin_anti_ganda_kurasi_beranda';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Aamiin dedupe and home curation tables against a populated database (PKS 3.7(5)-(6))', () => {
  if (!DATABASE_URL) {
    console.warn('[aamiin kurasi migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `aamiin_kurasi_${process.pid}`;
  let db: Client;
  let second: Client;

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
    await db.query(`INSERT INTO "Donation" (id, amount, "paymentMethod", "campaignId") VALUES ('d1', 10000, 'qris', 'c1')`);
    await db.query(
      `INSERT INTO "Prayer" (id, text, "donationId", "campaignId", "amiinCount") VALUES ('p1', 'doa satu', 'd1', 'c1', 7)`,
    );
    // The migration under test, applied to the populated tables.
    await db.query(sqlOf(THIS_MIGRATION));

    second = new Client({ connectionString: databaseUrlFor(databaseName) });
    await second.connect();
  }, 180_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await db?.end();
    await second?.end();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  it('leaves an existing Prayer and its count untouched', async () => {
    const { rows } = await db.query(`SELECT "amiinCount" FROM "Prayer" WHERE id = 'p1'`);
    expect(rows).toEqual([{ amiinCount: 7 }]);
  });

  const insertMark = (client: Client, id: string, marker: string) =>
    client.query(
      `INSERT INTO "AamiinMark" (id, "prayerId", marker) VALUES ($1, 'p1', $2) ON CONFLICT ("prayerId", marker) DO NOTHING`,
      [id, marker],
    );

  it('inserts a mark once per (Prayer, marker): the second insert for the same marker is a no-op', async () => {
    const first = await insertMark(db, 'm1', 'u:user-1');
    const again = await insertMark(db, 'm2', 'u:user-1');
    const other = await insertMark(db, 'm3', 'a:guest-1');

    expect([first.rowCount, again.rowCount, other.rowCount]).toEqual([1, 0, 1]);
  });

  it('two connections racing the same marker insert exactly one row between them', async () => {
    const results = await Promise.all([insertMark(db, 'r1', 'a:racer'), insertMark(second, 'r2', 'a:racer')]);

    expect(results.map((r) => r.rowCount).sort()).toEqual([0, 1]);
  });

  it('removes a Prayer\'s marks and highlight with the Prayer', async () => {
    await db.query(`INSERT INTO "PrayerHighlight" (id, "prayerId", position, "markedById") VALUES ('h1', 'p1', 0, 'admin-gone')`);
    await db.query(`DELETE FROM "Prayer" WHERE id = 'p1'`);

    const marks = await db.query(`SELECT count(*)::int AS n FROM "AamiinMark"`);
    const highlights = await db.query(`SELECT count(*)::int AS n FROM "PrayerHighlight"`);
    expect([marks.rows[0].n, highlights.rows[0].n]).toEqual([0, 0]);
  });

  it('keeps the record of who marked a Campaign after that account is gone (no foreign key), one mark per kind', async () => {
    await db.query(
      `INSERT INTO "CampaignFeature" (id, "campaignId", kind, position, "markedById") VALUES ('f1', 'c1', 'PILIHAN', 0, 'admin-gone')`,
    );
    await expect(
      db.query(
        `INSERT INTO "CampaignFeature" (id, "campaignId", kind, position, "markedById") VALUES ('f2', 'c1', 'PILIHAN', 1, 'x')`,
      ),
    ).rejects.toThrow(/CampaignFeature_campaignId_kind_key/);
    // The same Campaign may hold the other kind too.
    await db.query(
      `INSERT INTO "CampaignFeature" (id, "campaignId", kind, position, "markedById") VALUES ('f3', 'c1', 'UNGGULAN_KATEGORI', 0, 'admin-gone')`,
    );
    const { rows } = await db.query(`SELECT kind FROM "CampaignFeature" ORDER BY kind`);
    expect(rows).toEqual([{ kind: 'PILIHAN' }, { kind: 'UNGGULAN_KATEGORI' }]);
  });
});
