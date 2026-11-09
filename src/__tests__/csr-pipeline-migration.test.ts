// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * pks-pemenuhan/17: the `csr_pipeline_lengkap` migration, executed against a
 * database that ALREADY holds Partnership Inquiries at each of the three old
 * statuses, with the history that moved them.
 *
 * What must be shown on a populated database: every old row maps to the stage
 * the ticket names (NOT_YET_FOLLOWED_UP -> Baru, IN_PROGRESS -> Dihubungi,
 * DONE -> Selesai), in the Inquiry AND in each history row's from/to; the
 * default for a new Inquiry is Baru; the five new stages can be written; the
 * old codes are gone from the type; the new columns are empty on old rows; and
 * the "exactly one owner" CHECK on Document now allows an Inquiry-owned
 * proposal (with no uploader) while still refusing two owners or none, and
 * still holds the organisation Document that existed before.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 * It asserts nothing about later migrations: it applies the ones before this
 * one, then this one, and stops.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261111170000_csr_pipeline_lengkap';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('CSR pipeline migration against a populated database (pks-pemenuhan/17)', () => {
  if (!DATABASE_URL) {
    console.warn('[csr pipeline migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `csr_pipeline_${process.pid}`;
  let db: Client;

  const inquiry = (id: string, status: string) =>
    db.query(
      `INSERT INTO "PartnershipInquiry" (id, "programId", "companyName", "contactName", needs, status,
         "contactEmailHmac", "contactEmailHmacKeyId", "contactEmailCiphertext", "contactEmailKeyId", "updatedAt")
       VALUES ($1, 'prog1', 'PT Contoh', 'Rina', 'Ingin berkolaborasi', $2::"PartnershipInquiryStatus", 'h', 'k', 'c', 'k', now())`,
      [id, status],
    );

  const change = (id: string, inquiryId: string, from: string, to: string) =>
    db.query(
      `INSERT INTO "PartnershipInquiryStatusChange" (id, "inquiryId", "fromStatus", "toStatus", "actedById")
       VALUES ($1, $2, $3::"PartnershipInquiryStatus", $4::"PartnershipInquiryStatus", 'admin1')`,
      [id, inquiryId, from, to],
    );

  const document = (id: string, owners: { partnershipInquiryId?: string; partnerOrganisationId?: string; uploadedById?: string | null }) =>
    db.query(
      `INSERT INTO "Document" (id, "uploadedById", "partnerOrganisationId", "partnershipInquiryId", label, "contentType", "sizeBytes", "storagePath")
       VALUES ($1, $2, $3, $4, 'Berkas', 'application/pdf', 10, $5)`,
      [
        id,
        owners.uploadedById === undefined ? 'admin1' : owners.uploadedById,
        owners.partnerOrganisationId ?? null,
        owners.partnershipInquiryId ?? null,
        `${id.slice(0, 2)}/${id}`,
      ],
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
       VALUES ('admin1', 'Admin Kemitraan', 'h1', 'k', 'c1', 'k', now())`,
    );
    await db.query(
      `INSERT INTO "Program" (id, slug, title, sector, problem, beneficiaries, location, activities, budget, timeline, "updatedAt")
       VALUES ('prog1', 'klinik', 'Klinik Keliling', 'HEALTH', 'm', 'b', 'l', 'a', 1000, 't', now())`,
    );
    await db.query(
      `INSERT INTO "PartnerOrganisation" (id, name, "fundraiserId", "registeredById") VALUES ('org1', 'Yayasan Mitra', 'admin1', 'admin1')`,
    );
    // Written without the new column: it does not exist yet.
    await db.query(
      `INSERT INTO "Document" (id, "uploadedById", "partnerOrganisationId", label, "contentType", "sizeBytes", "storagePath")
       VALUES ('aa-old-org', 'admin1', 'org1', 'Akta', 'application/pdf', 10, 'aa/aa-old-org')`,
    );

    // One Inquiry at each old status, and the history that moved the later two.
    await inquiry('inq-new', 'NOT_YET_FOLLOWED_UP');
    await inquiry('inq-progress', 'IN_PROGRESS');
    await inquiry('inq-done', 'DONE');
    await change('chg-1', 'inq-progress', 'NOT_YET_FOLLOWED_UP', 'IN_PROGRESS');
    await change('chg-2', 'inq-done', 'NOT_YET_FOLLOWED_UP', 'IN_PROGRESS');
    await change('chg-3', 'inq-done', 'IN_PROGRESS', 'DONE');

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

  it('maps the three old statuses to Baru, Dihubungi and Selesai on existing Inquiries', async () => {
    const { rows } = await db.query(`SELECT id, status::text FROM "PartnershipInquiry" ORDER BY id`);
    expect(rows).toEqual([
      { id: 'inq-done', status: 'DONE' },
      { id: 'inq-new', status: 'NEW' },
      { id: 'inq-progress', status: 'CONTACTED' },
    ]);
  });

  it('maps the history rows too, so each step still reads as it did', async () => {
    const { rows } = await db.query(
      `SELECT id, "fromStatus"::text AS "from", "toStatus"::text AS "to", note, "picChanged", "picFromId", "picToId"
       FROM "PartnershipInquiryStatusChange" ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: 'chg-1', from: 'NEW', to: 'CONTACTED', note: null, picChanged: false, picFromId: null, picToId: null },
      { id: 'chg-2', from: 'NEW', to: 'CONTACTED', note: null, picChanged: false, picFromId: null, picToId: null },
      { id: 'chg-3', from: 'CONTACTED', to: 'DONE', note: null, picChanged: false, picFromId: null, picToId: null },
    ]);
  });

  it('leaves the new columns empty on old rows, and starts a new Inquiry at Baru', async () => {
    const old = await db.query(
      `SELECT "budgetRange", "periodStart", "periodEnd", "companyAddressCiphertext", "companyNpwpCiphertext", "picId"
       FROM "PartnershipInquiry" WHERE id = 'inq-new'`,
    );
    expect(old.rows).toEqual([
      { budgetRange: null, periodStart: null, periodEnd: null, companyAddressCiphertext: null, companyNpwpCiphertext: null, picId: null },
    ]);

    await db.query(
      `INSERT INTO "PartnershipInquiry" (id, "programId", "companyName", "contactName", needs,
         "contactEmailHmac", "contactEmailHmacKeyId", "contactEmailCiphertext", "contactEmailKeyId", "updatedAt")
       VALUES ('inq-fresh', 'prog1', 'PT Baru', 'Dewi', 'x', 'h2', 'k', 'c', 'k', now())`,
    );
    const fresh = await db.query(`SELECT status::text FROM "PartnershipInquiry" WHERE id = 'inq-fresh'`);
    expect(fresh.rows).toEqual([{ status: 'NEW' }]);
  });

  it('knows exactly the eight stages and no longer the old codes', async () => {
    const { rows } = await db.query(
      `SELECT unnest(enum_range(NULL::"PartnershipInquiryStatus"))::text AS value`,
    );
    expect(rows.map((r) => r.value)).toEqual([
      'NEW',
      'CONTACTED',
      'PROPOSAL',
      'NEGOTIATION',
      'APPROVED',
      'ONGOING',
      'DONE',
      'DROPPED',
    ]);
    await expect(inquiry('inq-old-code', 'IN_PROGRESS')).rejects.toThrow(/invalid input value for enum/);
  });

  it('accepts a PIC and a note with the history of the change', async () => {
    await db.query(`UPDATE "PartnershipInquiry" SET status = 'NEGOTIATION', "picId" = 'admin1' WHERE id = 'inq-new'`);
    await db.query(
      `INSERT INTO "PartnershipInquiryStatusChange" (id, "inquiryId", "fromStatus", "toStatus", "actedById", note, "picChanged", "picToId")
       VALUES ('chg-pic', 'inq-new', 'NEW', 'NEGOTIATION', 'admin1', 'Dipegang Admin Kemitraan', true, 'admin1')`,
    );
    const { rows } = await db.query(
      `SELECT note, "picChanged", "picToId" FROM "PartnershipInquiryStatusChange" WHERE id = 'chg-pic'`,
    );
    expect(rows).toEqual([{ note: 'Dipegang Admin Kemitraan', picChanged: true, picToId: 'admin1' }]);
    await expect(
      db.query(`UPDATE "PartnershipInquiryStatusChange" SET note = $1 WHERE id = 'chg-pic'`, ['x'.repeat(1001)]),
    ).rejects.toThrow(/too long/);
  });

  it("keeps the organisation's pre-existing Document, and accepts a proposal owned by an Inquiry with no uploader", async () => {
    const old = await db.query(`SELECT id FROM "Document" WHERE id = 'aa-old-org'`);
    expect(old.rows).toHaveLength(1);

    await document('bb-proposal', { partnershipInquiryId: 'inq-done', uploadedById: null });
    const { rows } = await db.query(
      `SELECT "partnershipInquiryId", "uploadedById", "campaignId", "partnerOrganisationId", "payoutId" FROM "Document" WHERE id = 'bb-proposal'`,
    );
    expect(rows).toEqual([
      { partnershipInquiryId: 'inq-done', uploadedById: null, campaignId: null, partnerOrganisationId: null, payoutId: null },
    ]);
  });

  it('still refuses a Document with two owners, and one with none', async () => {
    await expect(
      document('cc-two', { partnershipInquiryId: 'inq-done', partnerOrganisationId: 'org1' }),
    ).rejects.toThrow(/Document_one_owner/);
    await expect(document('dd-none', {})).rejects.toThrow(/Document_one_owner/);
  });

  it('refuses to delete an Inquiry that holds a proposal (onDelete: Restrict)', async () => {
    await expect(db.query(`DELETE FROM "PartnershipInquiry" WHERE id = 'inq-done'`)).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });

  it('lets a PIC be removed without erasing the Inquiry or its history (onDelete: SetNull)', async () => {
    await db.query(`INSERT INTO "User" (id, name, "emailHmac", "emailHmacKeyId", "emailCiphertext", "emailKeyId", "updatedAt")
       VALUES ('admin2', 'Admin Lain', 'h3', 'k', 'c3', 'k', now())`);
    await db.query(`UPDATE "PartnershipInquiry" SET "picId" = 'admin2' WHERE id = 'inq-progress'`);
    await db.query(`DELETE FROM "User" WHERE id = 'admin2'`);
    const { rows } = await db.query(`SELECT "picId" FROM "PartnershipInquiry" WHERE id = 'inq-progress'`);
    expect(rows).toEqual([{ picId: null }]);
  });
});
