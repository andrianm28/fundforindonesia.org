// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * PKS pemenuhan 09 (pasal 3.3-3.4): migrasi galeri Campaign, pernyataan
 * kebenaran data dan penolakan final, dijalankan pada database yang SUDAH
 * berisi Campaign. Job CI `migrations` hanya memigrasi database kosong, jadi
 * tidak bisa menunjukkan apa yang terjadi pada baris lama atau pada CHECK.
 *
 * Dilewati, dengan peringatan, tanpa TEST_DATABASE_URL (docs/agents/verification.md).
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261111090000_kampanye_galeri_pernyataan_penolakan_final';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe('kampanye_galeri_pernyataan_penolakan_final migration (SQL)', () => {
  const sql = sqlOf(THIS_MIGRATION)
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('only adds: it never drops, rewrites or deletes what is there', () => {
    expect(sql).not.toMatch(/\bDROP\b|\bUPDATE\b|\bDELETE\b|\bRENAME\b|\bTRUNCATE\b/i);
  });
});

describe.skipIf(!DATABASE_URL)('Campaign gallery migration against a populated database (PKS 3.3)', () => {
  if (!DATABASE_URL) {
    console.warn('[campaign gallery migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `campaign_gallery_${process.pid}`;
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
       VALUES ('c-old', 'c-old', 'Lama', 'd', 's', 'https://example.com/c.jpg', 1000000, 'kesehatan', 'u1', now())`,
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

  const images = (n: number) => Array.from({ length: n }, (_, i) => `/uploads/g${i}-ab.jpg`);

  const insertCampaign = (id: string, gallery: string[]) =>
    db.query(
      `INSERT INTO "Campaign" (id, slug, title, description, story, "coverImage", "targetAmount", category, "creatorId", "galleryImages", "updatedAt")
       VALUES ($1, $1, 'Baru', 'd', 's', 'https://example.com/c.jpg', 1000000, 'kesehatan', 'u1', $2, now())`,
      [id, gallery],
    );

  it('keeps the existing Campaign, with an empty gallery and a rejection that is not final', async () => {
    const { rows } = await db.query(
      `SELECT title, "galleryImages", "rejectionFinal" FROM "Campaign" WHERE id = 'c-old'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Lama');
    expect(rows[0].galleryImages ?? []).toEqual([]);
    expect(rows[0].rejectionFinal).toBe(false);
  });

  it('accepts a gallery of six images', async () => {
    await insertCampaign('c-six', images(6));

    const { rows } = await db.query(`SELECT cardinality("galleryImages") AS n FROM "Campaign" WHERE id = 'c-six'`);
    expect(rows[0].n).toBe(6);
  });

  it('refuses a gallery of seven images, on insert and on update', async () => {
    await expect(insertCampaign('c-seven', images(7))).rejects.toThrow(/Campaign_galleryImages_max6/);
    await expect(
      db.query(`UPDATE "Campaign" SET "galleryImages" = $1 WHERE id = 'c-old'`, [images(7)]),
    ).rejects.toThrow(/Campaign_galleryImages_max6/);

    const { rows } = await db.query(`SELECT "galleryImages" FROM "Campaign" WHERE id = 'c-old'`);
    expect(rows[0].galleryImages ?? []).toEqual([]);
  });
});
