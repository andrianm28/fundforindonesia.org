// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { findPrismaFieldReferences } from '../../tests/support/prisma-field-references';

/**
 * The contract step of ADR 0012 (prd-compliance 16): the plaintext columns for
 * email, phone and the bank account number are gone, so a stolen database dump
 * no longer hands over a Donor address.
 *
 * Two things hold that in place and they are checked in different places. CI's
 * `migrations` job runs `prisma migrate diff` and fails if prisma/schema.prisma
 * and prisma/migrations disagree, so a column re-added to the schema without a
 * migration fails there. What is here is the rest: that the drop is real rather
 * than nominal, and that nothing in the application quietly writes a contact
 * detail in the clear.
 */

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const CONTRACT_MIGRATION = 'prisma/migrations/20260930010000_drop_contact_plaintext/migration.sql';

/** The model body, so a field name elsewhere in the file is not mistaken for it. */
function model(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  expect(start, `model ${name} is missing from prisma/schema.prisma`).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n}', start));
}

describe('the plaintext contact columns', () => {
  // Uniqueness moves with the address, and this is the one assertion that says
  // so. The old `email @unique` was case-sensitive, so one person could hold
  // `Andi@x.id` and `andi@x.id` as two accounts; the lookup HMAC is computed from
  // the lowercased address, so those two collide now and the pair is one account.
  // `@unique` on the column is the declaration itself, which is what CI's
  // `migrations` job compares against the database -- an index name in the
  // schema file would say nothing about either.
  it('are gone from User, and the lookup that replaced its unique is the HMAC', () => {
    const user = model('User');

    expect(user).not.toMatch(/^\s*email\s+String/m);
    expect(user).not.toMatch(/^\s*phone\s+String/m);
    expect(user).toMatch(/^\s*emailHmac\s+String\s+@unique/m);
  });

  it('are gone from BankAccount, while the account name stays readable for Refund', () => {
    const bankAccount = model('BankAccount');

    expect(bankAccount).not.toMatch(/^\s*accountNumber\s+String/m);
    expect(bankAccount).toMatch(/accountNumberCiphertext\s+String\s*$/m);
    expect(bankAccount).toMatch(/^\s*accountName\s+String/m);
  });

  it('are gone from a Guest Donor contact, while the guest name stays readable', () => {
    const donation = model('Donation');

    expect(donation).not.toMatch(/^\s*guestEmail\s+String/m);
    expect(donation).not.toMatch(/^\s*guestPhone\s+String/m);
    expect(donation).toMatch(/^\s*guestName\s+String\?/m);
  });

  it('are gone from a Partnership Inquiry contact, while the contact name stays readable', () => {
    const inquiry = model('PartnershipInquiry');

    expect(inquiry).not.toMatch(/^\s*contactEmail\s+String/m);
    expect(inquiry).not.toMatch(/^\s*contactPhone\s+String/m);
    expect(inquiry).toMatch(/^\s*contactName\s+String/m);
  });
});

describe('the migration that drops them', () => {
  it('drops all seven plaintext columns', () => {
    const sql = readFileSync(CONTRACT_MIGRATION, 'utf8');

    for (const [table, columns] of [
      ['"User"', ['email', 'phone']],
      ['"BankAccount"', ['accountNumber']],
      ['"Donation"', ['guestEmail', 'guestPhone']],
      ['"PartnershipInquiry"', ['contactEmail', 'contactPhone']],
    ] as const) {
      const block = sql.slice(sql.indexOf(`ALTER TABLE ${table} DROP COLUMN`));
      for (const column of columns) {
        expect(block, `${table}.${column} is not dropped`).toMatch(new RegExp(`"${column}"`));
      }
    }
  });

  // The failure mode this step has to get right: a backfill that has not run
  // must stop the deploy, not drop the last copy. A guard that came after the
  // DROP, or in a second migration, would be too late.
  it('refuses, before dropping anything, while a plaintext value has nothing sealed for it', () => {
    const sql = readFileSync(CONTRACT_MIGRATION, 'utf8');
    const guard = sql.indexOf('RAISE EXCEPTION');
    const firstDrop = sql.indexOf('DROP COLUMN');

    expect(guard, 'the migration has no guard').toBeGreaterThan(-1);
    expect(sql).toMatch(/backfill-contact-fields\.ts/);
    expect(guard, 'the guard comes after the drop').toBeLessThan(firstDrop);
  });

  it('is the last word on the plaintext, not the first: nothing re-adds the columns', () => {
    const sql = readFileSync(CONTRACT_MIGRATION, 'utf8');

    for (const column of ['email', 'phone', 'accountNumber', 'guestEmail', 'guestPhone', 'contactEmail', 'contactPhone']) {
      expect(sql, `${column} is added back rather than dropped`).not.toMatch(
        new RegExp(`ADD COLUMN\\s+(COLUMN\\s+)?"${column}"\\s`),
      );
    }
  });
});

describe('application code', () => {
  const source = (file: string) => readFileSync(file, 'utf8');

  it('reaches a contact detail only through the one module that seals it', () => {
    // A text scan cannot tell `email:` in a Prisma `data` from `email:` in a
    // form body or a mail template, so it is not used to decide this. What is
    // checked here is the shape of the two modules the contract depends on, and
    // the type-checker guard below is what actually proves no reader names a
    // dropped column.
    expect(source('src/lib/contact-fields.ts')).toMatch(/export function sealUserEmail/);
    expect(source('src/lib/field-protection.ts')).toMatch(/sealUserEmail/);
  });

  // The real guard, and the one that starts biting the moment a column comes
  // back: the type checker resolves each name against Prisma's generated types,
  // so this is a statement about the database surface rather than about text.
  // It passes vacuously while the columns are gone -- which is the point, and is
  // why the schema assertions above carry the same contract.
  it('names none of the dropped columns in any application file or the seed', () => {
    const references = [
      { model: 'User', fields: ['email', 'phone'] },
      { model: 'BankAccount', fields: ['accountNumber'] },
      { model: 'Donation', fields: ['guestEmail', 'guestPhone'] },
      { model: 'PartnershipInquiry', fields: ['contactEmail', 'contactPhone'] },
    ].flatMap(({ model: modelName, fields }) =>
      findPrismaFieldReferences({
        model: modelName,
        fields,
        alsoScan: ['prisma/seed.ts', 'prisma/backfill-contact-fields.ts'],
      }),
    );

    expect(references).toEqual([]);
  }, 240_000);
});
