// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The migration behind the Fundraiser's verification data (PKS pemenuhan 08,
 * pasal 3.2), executed against a database that already holds the checklist the
 * earlier migrations seeded and a live Campaign. The CI `migrations` job
 * migrates an EMPTY database and proves schema.prisma is unchanged; it cannot
 * show what the seed does to rows already there. This does: the five new items
 * land scoped, none of them reaches a CHANGE or AMOUNT_REVIEW snapshot, an
 * Admin's edit survives a second run, and the phone is a ciphertext column.
 *
 * Skipped, visibly, without TEST_DATABASE_URL (docs/agents/verification.md).
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261111080000_data_verifikasi_penggalang';

const NEW_ITEMS = [
  'foto-diri-memegang-ktp',
  'bukti-alamat',
  'bukti-hubungan-penerima-manfaat',
  'surat-kuasa-lembaga',
  'dokumen-pendukung-program',
];

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('verification data migration against a populated database (PKS pemenuhan 08)', () => {
  if (!DATABASE_URL) {
    console.warn('[verification data migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `verification_data_${process.pid}`;
  let db: Client;
  let before: { id: string; position: number; kind: string | null }[];

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

    // A live organisation already on the register, as production has.
    await db.query(
      `INSERT INTO "User" (id, name, "emailHmac", "emailHmacKeyId", "emailCiphertext", "emailKeyId", "updatedAt")
       VALUES ('u1', 'Yayasan', 'h1', 'k', 'c1', 'k', now()), ('u2', 'Verifier', 'h2', 'k', 'c2', 'k', now())`,
    );
    await db.query(
      `INSERT INTO "PartnerOrganisation" (id, name, "fundraiserId", "registeredById")
       VALUES ('org1', 'Yayasan Lama', 'u1', 'u2')`,
    );
    before = (
      await db.query(`SELECT id, position, kind FROM "VerificationChecklistItem" ORDER BY position`)
    ).rows;

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

  it('adds the five items after the existing ones, active, a paper each, and only the surat kuasa optional', async () => {
    const { rows } = await db.query(
      `SELECT id, required, position, active, kind, "requiresDocument" FROM "VerificationChecklistItem"
       WHERE id = ANY($1) ORDER BY position`,
      [NEW_ITEMS],
    );
    expect(rows.map((r) => r.id)).toEqual(NEW_ITEMS);
    const lastBefore = Math.max(...before.map((r) => r.position));
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5].map((n) => lastBefore + n));
    expect(rows.every((r) => r.active && r.kind === null && r.requiresDocument)).toBe(true);
    expect(rows.filter((r) => !r.required).map((r) => r.id)).toEqual(['surat-kuasa-lembaga']);
  });

  it('scopes the KTP photo to an individual, the surat kuasa to an organisation, the rest to both', async () => {
    const { rows } = await db.query(
      `SELECT id, applicant FROM "VerificationChecklistItem" WHERE id = ANY($1) ORDER BY position`,
      [NEW_ITEMS],
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.applicant]))).toEqual({
      'foto-diri-memegang-ktp': 'INDIVIDUAL',
      'bukti-alamat': null,
      'bukti-hubungan-penerima-manfaat': null,
      'surat-kuasa-lembaga': 'ORGANISATION',
      'dokumen-pendukung-program': null,
    });
  });

  it('keeps every earlier item on all three kinds of request, and puts the five on a SUBMISSION only', async () => {
    const earlier = await db.query(
      `SELECT id, "requestKinds"::text[] AS kinds, applicant FROM "VerificationChecklistItem" WHERE id <> ALL($1)`,
      [NEW_ITEMS],
    );
    expect(earlier.rows.length).toBeGreaterThan(0);
    for (const row of earlier.rows) {
      expect([...row.kinds].sort()).toEqual(['AMOUNT_REVIEW', 'CHANGE', 'SUBMISSION']);
      expect(row.applicant).toBeNull();
    }
    const added = await db.query(
      `SELECT "requestKinds"::text[] AS kinds FROM "VerificationChecklistItem" WHERE id = ANY($1)`,
      [NEW_ITEMS],
    );
    expect(added.rows.map((r) => r.kinds)).toEqual(NEW_ITEMS.map(() => ['SUBMISSION']));
  });

  it("leaves a live Campaign's CHANGE and AMOUNT_REVIEW snapshot exactly what it was before the migration", async () => {
    // The same filter `snapshotChecklist` applies: active, any Kind, any
    // applicant, and the item names this kind of request.
    for (const requestKind of ['CHANGE', 'AMOUNT_REVIEW']) {
      for (const applicant of ['INDIVIDUAL', 'ORGANISATION']) {
        const { rows } = await db.query(
          `SELECT id FROM "VerificationChecklistItem"
           WHERE active AND kind IS NULL AND (applicant IS NULL OR applicant = $1::"ChecklistApplicant")
             AND $2::"VerificationRequestKind" = ANY ("requestKinds")
           ORDER BY position`,
          [applicant, requestKind],
        );
        expect(rows.map((r) => r.id)).toEqual(before.filter((b) => b.kind === null).map((b) => b.id));
      }
    }
  });

  it("is idempotent and never overwrites an Admin's edit: running the seed again writes nothing", async () => {
    await db.query(
      `UPDATE "VerificationChecklistItem" SET label = 'Diubah Admin', active = false, position = 99, "requestKinds" = ARRAY['SUBMISSION','CHANGE']::"VerificationRequestKind"[]
       WHERE id = 'bukti-alamat'`,
    );
    const snapshot = async () =>
      (await db.query(`SELECT * FROM "VerificationChecklistItem" ORDER BY id`)).rows;
    const edited = await snapshot();

    const seed = sqlOf(THIS_MIGRATION);
    await db.query(seed.slice(seed.indexOf('INSERT INTO "VerificationChecklistItem"')));

    expect(await snapshot()).toEqual(edited);
  });

  it("seals the responsible person's phone in ciphertext columns and leaves an existing organisation empty there", async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'PartnerOrganisation' AND column_name LIKE 'responsiblePerson%' ORDER BY column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'responsiblePersonName',
      'responsiblePersonPhoneCiphertext',
      'responsiblePersonPhoneKeyId',
      'responsiblePersonTitle',
    ]);
    const org = (await db.query(`SELECT * FROM "PartnerOrganisation" WHERE id = 'org1'`)).rows[0];
    expect(org).toMatchObject({
      address: null,
      responsiblePersonName: null,
      responsiblePersonTitle: null,
      responsiblePersonPhoneCiphertext: null,
      responsiblePersonPhoneKeyId: null,
    });
  });
});
