// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * pks-pemenuhan/12: the `penyaluran_revisi_dokumen_catatan` migration, executed
 * against a database that ALREADY holds a Payout, a Partner Organisation and
 * the Document that organisation owns.
 *
 * What must be shown on a populated database: the old rows survive untouched
 * (a Payout stays DRAFT with no note and no revision trail; the organisation's
 * Document is still valid under the rewritten "exactly one owner" CHECK), the
 * new status can be written, a Document may now be owned by a Payout, and the
 * CHECK still refuses a Document with two owners or none.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261111120000_penyaluran_revisi_dokumen_catatan';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('payout revision migration against a populated database (pks-pemenuhan/12)', () => {
  if (!DATABASE_URL) {
    console.warn('[payout revision migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `payout_revision_${process.pid}`;
  let db: Client;

  const document = (id: string, owners: { payoutId?: string; partnerOrganisationId?: string }) =>
    db.query(
      `INSERT INTO "Document" (id, "uploadedById", "partnerOrganisationId", "payoutId", label, "contentType", "sizeBytes", "storagePath")
       VALUES ($1, 'u1', $2, $3, 'Berkas', 'application/pdf', 10, $4)`,
      [id, owners.partnerOrganisationId ?? null, owners.payoutId ?? null, `${id.padEnd(2, '0').slice(0, 2)}/${id}`],
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
       VALUES ('u1', 'Fundraiser', 'h1', 'k', 'c1', 'k', now())`,
    );
    await db.query(
      `INSERT INTO "BankAccount" (id, "ownerId", "bankCode", "accountName", "accountNumberCiphertext", "accountNumberKeyId")
       VALUES ('b1', 'u1', 'BCA', 'Fundraiser', 'ct', 'k')`,
    );
    await db.query(
      `INSERT INTO "Payout" (id, "bankAccountId", amount, description, "requestedById", "updatedAt")
       VALUES ('p-old', 'b1', 100000, 'Sebelum migrasi', 'u1', now())`,
    );
    await db.query(
      `INSERT INTO "PartnerOrganisation" (id, name, "fundraiserId", "registeredById")
       VALUES ('org1', 'Yayasan Mitra', 'u1', 'u1')`,
    );
    // Written without the new column: it does not exist yet.
    await db.query(
      `INSERT INTO "Document" (id, "uploadedById", "partnerOrganisationId", label, "contentType", "sizeBytes", "storagePath")
       VALUES ('aa-old-org', 'u1', 'org1', 'Akta', 'application/pdf', 10, 'aa/aa-old-org')`,
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

  it('keeps an existing Payout as it was: DRAFT, no note, no revision trail', async () => {
    const { rows } = await db.query(
      `SELECT status, "supportingNote", "revisionReason", "revisionRequestedById", "revisionRequestedAt" FROM "Payout" WHERE id = 'p-old'`,
    );
    expect(rows).toEqual([
      { status: 'DRAFT', supportingNote: null, revisionReason: null, revisionRequestedById: null, revisionRequestedAt: null },
    ]);
  });

  it('accepts the new REVISION_REQUESTED status with its reason, who and when', async () => {
    await db.query(
      `UPDATE "Payout" SET status = 'REVISION_REQUESTED', "revisionReason" = 'Lampirkan RAB',
         "revisionRequestedById" = 'u1', "revisionRequestedAt" = now(), "supportingNote" = 'Catatan' WHERE id = 'p-old'`,
    );
    const { rows } = await db.query(`SELECT status, "revisionReason", "supportingNote" FROM "Payout" WHERE id = 'p-old'`);
    expect(rows).toEqual([{ status: 'REVISION_REQUESTED', revisionReason: 'Lampirkan RAB', supportingNote: 'Catatan' }]);
    await db.query(`UPDATE "Payout" SET status = 'DRAFT' WHERE id = 'p-old'`);
  });

  it('refuses a note over 1000 characters and a reason over 500 (the columns are bounded)', async () => {
    await expect(db.query(`UPDATE "Payout" SET "supportingNote" = $1 WHERE id = 'p-old'`, ['x'.repeat(1001)])).rejects.toThrow(
      /too long/,
    );
    await expect(db.query(`UPDATE "Payout" SET "revisionReason" = $1 WHERE id = 'p-old'`, ['x'.repeat(501)])).rejects.toThrow(
      /too long/,
    );
  });

  it("keeps the organisation's pre-existing Document, and accepts a Document owned by a Payout", async () => {
    const old = await db.query(`SELECT id FROM "Document" WHERE id = 'aa-old-org'`);
    expect(old.rows).toHaveLength(1);

    await document('bb-payout', { payoutId: 'p-old' });
    const { rows } = await db.query(`SELECT "payoutId", "campaignId", "partnerOrganisationId" FROM "Document" WHERE id = 'bb-payout'`);
    expect(rows).toEqual([{ payoutId: 'p-old', campaignId: null, partnerOrganisationId: null }]);
  });

  it('still refuses a Document with two owners, and one with none', async () => {
    await expect(document('cc-two', { payoutId: 'p-old', partnerOrganisationId: 'org1' })).rejects.toThrow(/Document_one_owner/);
    await expect(document('dd-none', {})).rejects.toThrow(/Document_one_owner/);
  });

  it('refuses to delete a Payout that holds supporting Documents (onDelete: Restrict)', async () => {
    await expect(db.query(`DELETE FROM "Payout" WHERE id = 'p-old'`)).rejects.toThrow(/foreign key|violates/);
  });
});
