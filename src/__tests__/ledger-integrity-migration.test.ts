// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Audit data D1/D5 + payments PAY-12: the `ledger_integrity` migration,
 * executed against a database that ALREADY holds ledger rows.
 *
 * Proves what the database does, not what the SQL says: the ledger refuses
 * UPDATE and DELETE, still accepts INSERT, refuses to lose its legs when a
 * parent row is deleted (FKs are RESTRICT, not SET NULL), refuses a
 * non-positive amount, and has the three FK indexes the public impact
 * queries filter on.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261016090000_ledger_integrity';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('ledger integrity migration against a populated database (D1, D5, PAY-12)', () => {
  if (!DATABASE_URL) {
    console.warn('[ledger integrity migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `ledger_integrity_${process.pid}`;
  let db: Client;

  const entry = (id: string, tx: string, leg: number, direction: 'DEBIT' | 'CREDIT', amount: number, campaignId: string | null = null) =>
    db.query(
      `INSERT INTO "LedgerEntry" (id, account, direction, amount, "transactionId", "legIndex", "campaignId", "createdAt")
       VALUES ($1, 'GATEWAY_CLEARING', $2, $3, $4, $5, $6, now())`,
      [id, direction, amount, tx, leg, campaignId],
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

    // Pre-existing, healthy ledger: one balanced journal, one leg with a parent.
    await db.query(
      `INSERT INTO "User" (id, name, "emailHmac", "emailHmacKeyId", "emailCiphertext", "emailKeyId", "updatedAt")
       VALUES ('u1', 'Fundraiser', 'h1', 'k', 'c1', 'k', now())`,
    );
    await db.query(
      `INSERT INTO "Campaign" (id, slug, title, description, story, "coverImage", "targetAmount", category, "creatorId", "updatedAt")
       VALUES ('c1', 'c1', 'T', 'd', 's', 'https://example.com/c.jpg', 1000000, 'x', 'u1', now())`,
    );
    await entry('pre-1', 'tx-pre', 0, 'DEBIT', 50_000);
    await entry('pre-2', 'tx-pre', 1, 'CREDIT', 50_000, 'c1');
    // A legacy zero-amount leg (history before 2026-10-03 is squashed, so one
    // cannot be ruled out): it must not stop the migration from applying.
    await entry('legacy-0', 'tx-legacy', 0, 'DEBIT', 0);

    await db.query(sqlOf(THIS_MIGRATION));
  }, 180_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await db?.end();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  it('keeps the rows that existed before the migration', async () => {
    const { rows } = await db.query(`SELECT id FROM "LedgerEntry" WHERE "transactionId" = 'tx-pre' ORDER BY id`);
    expect(rows.map((r) => r.id)).toEqual(['pre-1', 'pre-2']);
  });

  it('applies over a legacy amount <= 0 row: the CHECK is NOT VALID, so it guards new rows only', async () => {
    const { rows } = await db.query(`SELECT amount FROM "LedgerEntry" WHERE id = 'legacy-0'`);
    expect(rows[0].amount).toBe(0);
    const { rows: con } = await db.query(
      `SELECT convalidated FROM pg_constraint WHERE conname = 'LedgerEntry_amount_positive'`,
    );
    expect(con[0].convalidated).toBe(false);
  });

  it('still accepts INSERT of a new balanced journal', async () => {
    await entry('new-1', 'tx-new', 0, 'DEBIT', 1_000);
    await entry('new-2', 'tx-new', 1, 'CREDIT', 1_000);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM "LedgerEntry" WHERE "transactionId" = 'tx-new'`);
    expect(rows[0].n).toBe(2);
  });

  it('rejects UPDATE of any column', async () => {
    await expect(db.query(`UPDATE "LedgerEntry" SET amount = 1 WHERE id = 'pre-1'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`UPDATE "LedgerEntry" SET "campaignId" = NULL WHERE id = 'pre-2'`)).rejects.toThrow(/append-only/);
    const { rows } = await db.query(`SELECT amount FROM "LedgerEntry" WHERE id = 'pre-1'`);
    expect(rows[0].amount).toBe(50_000);
  });

  it('rejects DELETE', async () => {
    await expect(db.query(`DELETE FROM "LedgerEntry" WHERE id = 'pre-1'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM "LedgerEntry"`)).rejects.toThrow(/append-only/);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM "LedgerEntry"`);
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('refuses to delete a parent instead of silently detaching its ledger legs (FK RESTRICT)', async () => {
    await expect(db.query(`DELETE FROM "Campaign" WHERE id = 'c1'`)).rejects.toThrow(/foreign key/i);
    const { rows } = await db.query(`SELECT "campaignId" FROM "LedgerEntry" WHERE id = 'pre-2'`);
    expect(rows[0].campaignId).toBe('c1');
  });

  it('has no ON DELETE SET NULL left on a LedgerEntry foreign key', async () => {
    const { rows } = await db.query(
      `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = '"LedgerEntry"'::regclass AND contype = 'f'`,
    );
    expect(rows.length).toBe(7);
    expect(rows.filter((r) => r.confdeltype !== 'r')).toEqual([]);
  });

  it('rejects a zero or negative amount', async () => {
    await expect(entry('bad-0', 'tx-bad', 0, 'DEBIT', 0)).rejects.toThrow(/LedgerEntry_amount_positive/);
    await expect(entry('bad-n', 'tx-bad', 0, 'DEBIT', -5)).rejects.toThrow(/LedgerEntry_amount_positive/);
  });

  it('indexes paymentId, refundId and payoutId', async () => {
    const { rows } = await db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'LedgerEntry'`);
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining(['LedgerEntry_paymentId_idx', 'LedgerEntry_refundId_idx', 'LedgerEntry_payoutId_idx']),
    );
  });
});
