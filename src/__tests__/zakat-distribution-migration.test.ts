// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * PKS pemenuhan 19 (ADR 0028): the ZakatDistribution record table applied to a
 * database that already holds a Partner Organisation. It is a record only:
 * the table has no link to the ledger, and a recorded distribution keeps its
 * institution and Admin from being deleted out from under it.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 * Deliberately does not assert that no later migration exists.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261111190000_modul_zakat_penyaluran';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('ZakatDistribution table against a populated database (PKS 19)', () => {
  if (!DATABASE_URL) {
    console.warn('[zakat distribution migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `zakat_dist_${process.pid}`;
  let db: Client;

  const insertDistribution = (id: string, over: { amount?: number; asnaf?: string } = {}) =>
    db.query(
      `INSERT INTO "ZakatDistribution" (id, "organisationId", amount, asnaf, "distributedAt", "recipientSummary", "recordedById")
       VALUES ($1, 'org1', $2, $3::"ZakatAsnaf", '2026-11-09T00:00:00Z', '25 keluarga di Desa Contoh', 'admin1')`,
      [id, over.amount ?? 500000, over.asnaf ?? 'FAKIR'],
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

    for (const id of ['fundraiser1', 'verifier1', 'admin1']) {
      await db.query(
        `INSERT INTO "User" (id, name, "emailHmac", "emailHmacKeyId", "emailCiphertext", "emailKeyId", "updatedAt")
         VALUES ($1, $1, $2, 'k', 'c', 'k', now())`,
        [id, `h-${id}`],
      );
    }
    await db.query(
      `INSERT INTO "PartnerOrganisation" (id, name, "fundraiserId", "registeredById") VALUES ('org1', 'Yayasan Contoh', 'fundraiser1', 'verifier1')`,
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

  it('starts empty and leaves the existing Partner Organisation untouched', async () => {
    const zakat = await db.query(`SELECT count(*)::int AS n FROM "ZakatDistribution"`);
    const org = await db.query(`SELECT name FROM "PartnerOrganisation" WHERE id = 'org1'`);
    expect([zakat.rows[0].n, org.rows]).toEqual([0, [{ name: 'Yayasan Contoh' }]]);
  });

  it('records a distribution without touching the ledger: the table has no ledger column and writes no entry', async () => {
    const before = await db.query(`SELECT count(*)::int AS n FROM "LedgerEntry"`);
    await insertDistribution('z1');
    const after = await db.query(`SELECT count(*)::int AS n FROM "LedgerEntry"`);
    const columns = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ZakatDistribution'`,
    );

    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(columns.rows.map((c) => c.column_name).filter((c) => /ledger|transaction|payout/i.test(c))).toEqual([]);
  });

  it('refuses an asnaf outside the eight', async () => {
    await expect(insertDistribution('z2', { asnaf: 'LAINNYA' })).rejects.toThrow(/ZakatAsnaf/);
  });

  it('keeps the institution and the recording Admin from being deleted while a distribution refers to them', async () => {
    await expect(db.query(`DELETE FROM "PartnerOrganisation" WHERE id = 'org1'`)).rejects.toThrow(
      /ZakatDistribution_organisationId_fkey/,
    );
    await expect(db.query(`DELETE FROM "User" WHERE id = 'admin1'`)).rejects.toThrow(/ZakatDistribution_recordedById_fkey/);
  });
});
