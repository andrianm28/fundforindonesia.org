// @vitest-environment node
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, it, expect } from 'vitest';

/**
 * The guard in the migration that drops the contact plaintext columns
 * (prd-compliance 16, the contract step), against a real Postgres.
 *
 * Two things can make the drop unsafe, and the second one is the one a deploy
 * can walk into without anybody noticing:
 *
 * - a row whose plaintext has nothing sealed for it, which is what the backfill
 *   exists to prevent;
 * - a table sealed under more than one key id. The backfill seals each row with
 *   whatever `FIELD_ENCRYPTION_KEY_ID` the deployment has at the moment it runs,
 *   and it skips rows that are already sealed, so changing the key between two
 *   runs leaves rows under two ids. `decrypt` refuses a key id it has no key
 *   for -- there is no keyring yet (ADR 0012, Consequences) -- and the plaintext
 *   this migration drops is the only copy left to re-seal them from. The guard
 *   checked only for NULL, so it waved that through.
 *
 * The tests run the migration's own `DO` block, extracted from the file, over
 * rows seeded with two different key ids, and they need a database to do it.
 * Set TEST_DATABASE_URL to run them; without it the whole block is skipped, and
 * the two assertions below -- which only read the file -- are what remains. They
 * are here so the file is still checked somewhere, not as a substitute for
 * running it.
 */

const MIGRATION = 'prisma/migrations/20260930010000_drop_contact_plaintext/migration.sql';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** The guard as the migration writes it: its `DO` block, and nothing after it. */
function guard(): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('DO $$');
  const end = sql.indexOf('END $$;');
  expect(start, 'the migration has no guard').toBeGreaterThan(-1);
  expect(end, 'the guard has no END').toBeGreaterThan(start);
  return sql.slice(start, end + 'END $$;'.length);
}

/**
 * The four tables the guard reads, with the plaintext and sealed columns and
 * nothing else. Narrower than the real schema on purpose: what is under test is
 * the guard, and a table that does not exist cannot raise.
 */
const TABLES = `
  CREATE SCHEMA ffi_guard;
  SET search_path TO ffi_guard;
  CREATE TABLE "User" (
    "id" text PRIMARY KEY, "email" text, "phone" text,
    "emailCiphertext" text, "emailKeyId" text, "emailHmac" text, "emailHmacKeyId" text,
    "phoneCiphertext" text, "phoneKeyId" text
  );
  CREATE TABLE "BankAccount" (
    "id" text PRIMARY KEY, "accountNumber" text, "accountNumberCiphertext" text, "accountNumberKeyId" text
  );
  CREATE TABLE "Donation" (
    "id" text PRIMARY KEY, "guestEmail" text, "guestPhone" text,
    "guestEmailCiphertext" text, "guestEmailKeyId" text, "guestEmailHmac" text, "guestEmailHmacKeyId" text,
    "guestPhoneCiphertext" text, "guestPhoneKeyId" text
  );
  CREATE TABLE "PartnershipInquiry" (
    "id" text PRIMARY KEY, "contactEmail" text, "contactPhone" text,
    "contactEmailCiphertext" text, "contactEmailKeyId" text, "contactEmailHmac" text, "contactEmailHmacKeyId" text,
    "contactPhoneCiphertext" text, "contactPhoneKeyId" text
  );
`;

/** A fully backfilled row: nothing NULL for the guard to object to. */
function sealedRow(table: string, id: string, columns: Record<string, string>): string {
  return `INSERT INTO "${table}" ("id", ${Object.keys(columns).map((c) => `"${c}"`).join(', ')})
    VALUES ('${id}', ${Object.values(columns).map((v) => `'${v}'`).join(', ')});`;
}

const USER_EMAIL = {
  email: 'andi@email.com',
  emailCiphertext: 'sealed',
  emailKeyId: 'enc-1',
  emailHmac: 'hmac-value',
  emailHmacKeyId: 'hmac-1',
};

/**
 * Runs the guard over a throwaway schema, in one transaction that is rolled
 * back: the rows it seeded leave nothing behind in the database it was given.
 */
async function runGuard(rows: string[]): Promise<{ message: string } | null> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(TABLES);
    for (const row of rows) await client.query(row);
    try {
      await client.query(guard());
      return null;
    } catch (error) {
      return { message: (error as Error).message };
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

describe('the guard in the drop migration, as the file states it', () => {
  it('is raised before the first DROP COLUMN, not after it', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('DROP COLUMN'));
  });

  it('looks at the key ids, and at every table the drop touches', () => {
    const sql = guard();
    for (const column of [
      'emailKeyId',
      'emailHmacKeyId',
      'phoneKeyId',
      'accountNumberKeyId',
      'guestEmailKeyId',
      'guestEmailHmacKeyId',
      'guestPhoneKeyId',
      'contactEmailKeyId',
      'contactEmailHmacKeyId',
      'contactPhoneKeyId',
    ]) {
      expect(sql, `the guard says nothing about ${column}`).toContain(`"${column}"`);
    }
  });
});

describe.skipIf(!DATABASE_URL)('the drop migration guard, run against Postgres', () => {
  it('refuses to drop while two rows are sealed under different keys, naming both', async () => {
    const raised = await runGuard([
      sealedRow('User', 'u1', { ...USER_EMAIL }),
      sealedRow('User', 'u2', { ...USER_EMAIL, emailKeyId: 'enc-2', emailCiphertext: 'sealed-again' }),
    ]);

    expect(raised).not.toBeNull();
    // Which field, which key ids, and which rows: the owner has to be able to
    // act on this, and "the migration refused" is not actionable.
    expect(raised!.message).toContain('User.email');
    expect(raised!.message).toContain('enc-1');
    expect(raised!.message).toContain('enc-2');
    expect(raised!.message).toContain('"u1"');
    expect(raised!.message).toContain('"u2"');
  });

  // The lookup key is a second rotation hazard, and a nastier one: a Donor
  // sealed under an older HMAC key cannot be found by their address at all,
  // which is a sign-in that fails with no error anywhere.
  it('refuses the same way when the key that moved is the one accounts are found by', async () => {
    const raised = await runGuard([
      sealedRow('User', 'u1', { ...USER_EMAIL }),
      sealedRow('User', 'u2', { ...USER_EMAIL, emailHmacKeyId: 'hmac-2' }),
    ]);

    expect(raised?.message).toContain('hmac-1');
    expect(raised!.message).toContain('hmac-2');
    expect(raised!.message).toContain('"u2"');
  });

  it('refuses for a table other than User, so a rotation is not caught only for Donors', async () => {
    const raised = await runGuard([
      sealedRow('BankAccount', 'b1', { accountNumber: '1234567890', accountNumberCiphertext: 'a', accountNumberKeyId: 'enc-1' }),
      sealedRow('BankAccount', 'b2', { accountNumber: '1234567890', accountNumberCiphertext: 'b', accountNumberKeyId: 'enc-2' }),
    ]);

    expect(raised!.message).toContain('BankAccount.accountNumber');
    expect(raised!.message).toContain('"b1"');
    expect(raised!.message).toContain('"b2"');
  });

  // Without this the three above would pass on a guard that always refuses.
  it('lets the drop through when every row is sealed under the same key', async () => {
    const raised = await runGuard([
      sealedRow('User', 'u1', { ...USER_EMAIL }),
      sealedRow('User', 'u2', { ...USER_EMAIL, email: 'budi@email.com', emailHmac: 'other', emailCiphertext: 'sealed-2' }),
      sealedRow('BankAccount', 'b1', { accountNumber: '1234567890', accountNumberCiphertext: 'a', accountNumberKeyId: 'enc-1' }),
      // A row that never had a phone: NULL there is not a mixed key.
      sealedRow('User', 'u3', { ...USER_EMAIL, email: 'sari@email.com', emailHmac: 'third', emailCiphertext: 'sealed-3', phoneCiphertext: 'p', phoneKeyId: 'enc-1' }),
    ]);

    expect(raised).toBeNull();
  });

  // The check the guard existed for, kept: a plaintext with nothing sealed for
  // it is still the reason the backfill runs first. The row is also the one row
  // under a second key, so the message proves the unsealed check is still the
  // one that fires.
  it('still refuses a plaintext value that has nothing sealed for it', async () => {
    const raised = await runGuard([
      sealedRow('User', 'u1', { ...USER_EMAIL }),
      sealedRow('User', 'u2', { ...USER_EMAIL, emailKeyId: 'enc-2', emailCiphertext: 'sealed-2' }),
      `UPDATE "User" SET "emailCiphertext" = NULL WHERE "id" = 'u2';`,
    ]);

    expect(raised?.message).toContain('User.email');
    expect(raised!.message).not.toContain('enc-2');
  });
});
