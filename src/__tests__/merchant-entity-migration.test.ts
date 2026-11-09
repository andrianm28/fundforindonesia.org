// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * pks-pemenuhan/04: the `merchant_entity_ledger` migration, executed against a
 * database that ALREADY holds ledger rows, a Payment and a ProviderWithdrawal.
 *
 * What must be shown on a populated database: every old row is backfilled to
 * YAYASAN, and the append-only trigger is still intact afterwards (UPDATE and
 * DELETE refused), because the migration backfills without an UPDATE. A new
 * row that names no entity is refused (no default is left on the ledger
 * column), while Payment and ProviderWithdrawal keep their YAYASAN default.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261110090000_merchant_entity_ledger';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('merchant entity migration against a populated database (pks-pemenuhan/04)', () => {
  if (!DATABASE_URL) {
    console.warn('[merchant entity migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `merchant_entity_${process.pid}`;
  let db: Client;

  const entry = (id: string, tx: string, leg: number, direction: 'DEBIT' | 'CREDIT', amount: number, extra = '') =>
    db.query(
      `INSERT INTO "LedgerEntry" (id, account, direction, amount, "transactionId", "legIndex", "createdAt"${extra ? ', "merchantEntity"' : ''})
       VALUES ($1, 'GATEWAY_CLEARING', $2, $3, $4, $5, now()${extra ? `, '${extra}'` : ''})`,
      [id, direction, amount, tx, leg],
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
       VALUES ('u1', 'Admin', 'h1', 'k', 'c1', 'k', now())`,
    );
    // Pre-existing, healthy ledger: one balanced journal, three legs of history.
    await db.query(
      `INSERT INTO "LedgerEntry" (id, account, direction, amount, "transactionId", "legIndex", provider, "createdAt")
       VALUES ('pre-1', 'GATEWAY_CLEARING', 'DEBIT', 50000, 'tx-pre', 0, 'sumopod', now()),
              ('pre-2', 'ESCROW_HOLD', 'CREDIT', 50000, 'tx-pre', 1, 'sumopod', now())`,
    );
    await db.query(
      `INSERT INTO "ProviderWithdrawal" (id, provider, reference, amount, "destinationName",
         "providerBalanceBefore", "providerBalanceAfter", "proofReference", "recordedById")
       VALUES ('pw-1', 'sumopod', 'ref-1', 10, 'PT', 100, 90, 'proof', 'u1')`,
    );

    // A webhook event received before the merchants existed.
    await db.query(
      `INSERT INTO "WebhookEvent" (id, provider, "providerEventId", payload)
       VALUES ('we-pre', 'sumopod', 'evt-1', '{}')`,
    );

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

  it('backfills every pre-existing ledger row to YAYASAN and keeps the rest of the row', async () => {
    const { rows } = await db.query(
      `SELECT id, amount, provider, "merchantEntity", "collectingEntityId", "actorId" FROM "LedgerEntry" ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: 'pre-1', amount: 50000, provider: 'sumopod', merchantEntity: 'YAYASAN', collectingEntityId: null, actorId: null },
      { id: 'pre-2', amount: 50000, provider: 'sumopod', merchantEntity: 'YAYASAN', collectingEntityId: null, actorId: null },
    ]);
  });

  it('backfills a ProviderWithdrawal to YAYASAN', async () => {
    const { rows } = await db.query(`SELECT "merchantEntity" FROM "ProviderWithdrawal" WHERE id = 'pw-1'`);
    expect(rows).toEqual([{ merchantEntity: 'YAYASAN' }]);
  });

  it('leaves the append-only trigger intact and enabled: UPDATE and DELETE are still refused', async () => {
    const { rows } = await db.query(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'LedgerEntry_append_only' AND tgrelid = '"LedgerEntry"'::regclass`,
    );
    expect(rows).toEqual([{ tgenabled: 'O' }]);
    await expect(db.query(`UPDATE "LedgerEntry" SET "merchantEntity" = 'BADAN_USAHA' WHERE id = 'pre-1'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query(`DELETE FROM "LedgerEntry" WHERE id = 'pre-1'`)).rejects.toThrow(/append-only/);
    const { rows: after } = await db.query(`SELECT "merchantEntity" FROM "LedgerEntry" WHERE id = 'pre-1'`);
    expect(after).toEqual([{ merchantEntity: 'YAYASAN' }]);
  });

  it('refuses a new ledger row that names no entity, and accepts one that does', async () => {
    await expect(entry('new-0', 'tx-new0', 0, 'DEBIT', 1000)).rejects.toThrow(/merchantEntity/);
    await entry('new-1', 'tx-new', 0, 'DEBIT', 1000, 'BADAN_USAHA');
    const { rows } = await db.query(`SELECT "merchantEntity" FROM "LedgerEntry" WHERE id = 'new-1'`);
    expect(rows).toEqual([{ merchantEntity: 'BADAN_USAHA' }]);
  });

  it('refuses an entity that is not one of the two', async () => {
    await expect(entry('new-x', 'tx-x', 0, 'DEBIT', 1000, 'NOBODY')).rejects.toThrow(/invalid input value for enum/);
  });

  it('keeps the YAYASAN default on Payment and ProviderWithdrawal', async () => {
    const { rows } = await db.query(
      `SELECT table_name, column_default FROM information_schema.columns
       WHERE column_name = 'merchantEntity' ORDER BY table_name`,
    );
    expect(rows.map((r) => [r.table_name, r.column_default])).toEqual([
      ['LedgerEntry', null],
      ['Payment', "'YAYASAN'::\"MerchantEntity\""],
      ['ProviderWithdrawal', "'YAYASAN'::\"MerchantEntity\""],
      ['WebhookEvent', null],
    ]);
  });

  it('backfills an old WebhookEvent to YAYASAN, and keys idempotency on (provider, merchantEntity, providerEventId)', async () => {
    const { rows } = await db.query(`SELECT "merchantEntity" FROM "WebhookEvent" WHERE id = 'we-pre'`);
    expect(rows).toEqual([{ merchantEntity: 'YAYASAN' }]);
    const insert = (id: string, entity: string) =>
      db.query(
        `INSERT INTO "WebhookEvent" (id, provider, "merchantEntity", "providerEventId", payload) VALUES ($1, 'sumopod', $2, 'evt-1', '{}')`,
        [id, entity],
      );
    // The same event id on the other merchant is a different event...
    await insert('we-bu', 'BADAN_USAHA');
    // ...but a replay on the same merchant is still refused.
    await expect(insert('we-dup', 'YAYASAN')).rejects.toThrow(/duplicate key/);
    await expect(insert('we-dup-bu', 'BADAN_USAHA')).rejects.toThrow(/duplicate key/);
  });

  it('adds the foreign keys validated, and the two mostly-null indexes as partial indexes', async () => {
    const fks = await db.query(
      `SELECT conname, convalidated FROM pg_constraint
       WHERE conname IN ('LedgerEntry_collectingEntityId_fkey', 'LedgerEntry_actorId_fkey') ORDER BY conname`,
    );
    expect(fks.rows).toEqual([
      { conname: 'LedgerEntry_actorId_fkey', convalidated: true },
      { conname: 'LedgerEntry_collectingEntityId_fkey', convalidated: true },
    ]);
    const idx = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE indexname IN ('LedgerEntry_collectingEntityId_idx', 'LedgerEntry_actorId_idx') ORDER BY indexname`,
    );
    expect(idx.rows).toHaveLength(2);
    expect(idx.rows[0].indexdef).toMatch(/WHERE \("actorId" IS NOT NULL\)/);
    expect(idx.rows[1].indexdef).toMatch(/WHERE \("collectingEntityId" IS NOT NULL\)/);
  });

  it('gives the new foreign keys ON DELETE RESTRICT', async () => {
    const { rows } = await db.query(
      `SELECT conname, confdeltype FROM pg_constraint
       WHERE conrelid = '"LedgerEntry"'::regclass AND conname IN ('LedgerEntry_collectingEntityId_fkey', 'LedgerEntry_actorId_fkey')
       ORDER BY conname`,
    );
    expect(rows).toEqual([
      { conname: 'LedgerEntry_actorId_fkey', confdeltype: 'r' },
      { conname: 'LedgerEntry_collectingEntityId_fkey', confdeltype: 'r' },
    ]);
  });
});
