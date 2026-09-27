// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { runContactFieldBackfill, type BackfillDatabase } from './backfill';
import { readDonationGuestEmail, readUserEmail } from './contact-fields';

/**
 * The backfill for the contract step (prd-compliance 16): every row written
 * before the keys were configured has NULL in the protected columns, and the
 * migration that drops the plaintext refuses to run until each of them has been
 * filled. This is the step that fills them, and it is deliberately a script the
 * owner runs by hand rather than part of the migration, because it needs the
 * keys and because it must be able to stop and be re-run.
 *
 * The seam is the function, driven against a hand-written double standing in
 * for the database: what matters is which rows it decides to touch, that it is
 * safe to run twice, and that it reports rather than guesses.
 *
 * The double answers the same two questions the real one does -- rows the
 * filter would return, and rows a write touched -- by actually applying the
 * WHERE clause to rows in memory. That is what makes these tests able to catch a
 * filter that matches the wrong rows, which is the failure this step cannot
 * afford.
 */

type UserRow = { id: string; email: string | null; phone: string | null } & Record<string, string | null>;
type DonationRow = { id: string; guestEmail: string | null } & Record<string, string | null>;
type Row = UserRow | DonationRow;

/** A User written before the keys were set: plaintext, and nothing protected. */
function unsealedUser(id: string, email: string, phone: string | null = null): UserRow {
  return {
    id,
    email,
    phone,
    emailHmac: null,
    emailHmacKeyId: null,
    emailCiphertext: null,
    emailKeyId: null,
    phoneCiphertext: null,
    phoneKeyId: null,
  };
}

/**
 * Answers the backfill's two statements over rows held in memory, by reading the
 * statement the way Postgres would: table, WHERE columns, and `$n` bindings.
 */
function inMemoryDatabase(seed: { users?: UserRow[]; donations?: DonationRow[]; bankAccounts?: Row[]; inquiries?: Row[] }) {
  const tables: Record<string, Row[]> = {
    '"User"': seed.users ?? [],
    '"Donation"': seed.donations ?? [],
    '"BankAccount"': seed.bankAccounts ?? [],
    '"PartnershipInquiry"': seed.inquiries ?? [],
  };

  /** The table and plaintext column each `SELECT ... AS "value"` names. */
  const columnOf = (sql: string) => /SELECT "id", "(\w+)" AS "value" FROM ("\w+")/.exec(sql)!.slice(1) as [string, string];
  /** The protected columns the WHERE clause tests for NULL, read off the statement. */
  // `IS NULL`, not `IS NOT NULL`: the first is the filter, the second the
  // plaintext guard, and reading the wrong one would make every test vacuous.
  const sealedOf = (sql: string) => [...sql.matchAll(/"(\w+)" IS NULL/g)].map((match) => match[1]!);

  let writes = 0;
  const db: BackfillDatabase = {
    async query(sql, values) {
      const [column, table] = columnOf(sql);
      const [cursor, limit] = values as [string, number];
      return tables[table]!
        .filter((row) => {
          if (row[column] == null) return false;
          // The "any protected column is NULL" half of the filter, over exactly
          // the columns this statement names.
          if (!sealedOf(sql).some((c) => row[c] == null)) return false;
          return row.id > cursor;
        })
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((row) => ({ id: row.id, value: row[column] }));
    },
    async execute(sql, values) {
      writes += 1;
      const table = /UPDATE ("\w+") SET/.exec(sql)![1]!;
      const assignments = [...sql.matchAll(/"(\w+)" = \$(\d+)/g)];
      const [id] = values as [string];
      const row = tables[table]!.find((r) => r.id === id);
      if (!row) return 0;
      for (const [, column, placeholder] of assignments) {
        row[column] = values[Number(placeholder) - 1] as string | null;
      }
      return 1;
    },
  };
  return { db, tables, writes: () => writes };
}

describe('the backfill', () => {
  it('fills the protected columns of a row written before the keys were set', async () => {
    const { db, tables } = inMemoryDatabase({ users: [unsealedUser('u1', 'Andi@Email.com', '0812')] });

    const report = await runContactFieldBackfill(db, () => {});

    expect(report.filled).toEqual({ 'User.email': 1, 'User.phone': 1 });
    expect(readUserEmail(tables['"User"']![0] as never)).toBe('Andi@Email.com');
  });

  it('writes the ciphertext beside the lookup, not one without the other', async () => {
    const { db, tables } = inMemoryDatabase({ users: [unsealedUser('u1', 'andi@email.com')] });

    await runContactFieldBackfill(db, () => {});

    const row = tables['"User"']![0]!;
    expect(row.emailHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(row.emailCiphertext).not.toBeNull();
    expect(row.emailKeyId).not.toBeNull();
  });

  it('leaves an already-protected row exactly as it is, so a second run writes nothing', async () => {
    const first = inMemoryDatabase({ users: [unsealedUser('u1', 'andi@email.com')] });
    await runContactFieldBackfill(first.db, () => {});

    const second = inMemoryDatabase({ users: first.tables['"User"'] as UserRow[] });
    const report = await runContactFieldBackfill(second.db, () => {});

    expect(report.filled).toEqual({});
    expect(second.writes()).toBe(0);
  });

  // A half row is a lookup with no ciphertext beside it, which reads back as
  // nothing at all. Leaving it alone would let the migration's guard pass over a
  // value that is already gone.
  it('fills a half-protected row whole, because a lookup with no ciphertext reads as nothing', async () => {
    const { db, tables } = inMemoryDatabase({
      users: [{ ...unsealedUser('u1', 'andi@email.com'), emailHmac: 'orphaned' }],
    });

    await runContactFieldBackfill(db, () => {});

    expect(tables['"User"']![0]!.emailHmac).not.toBe('orphaned');
    expect(readUserEmail(tables['"User"']![0] as never)).toBe('andi@email.com');
  });

  it('fills a Guest Donor contact the same way, so a Receipt can still reach them', async () => {
    const { db, tables } = inMemoryDatabase({
      donations: [
        {
          id: 'd1',
          guestEmail: 'guest@email.com',
          guestEmailHmac: null,
          guestEmailHmacKeyId: null,
          guestEmailCiphertext: null,
          guestEmailKeyId: null,
        },
      ],
    });

    const report = await runContactFieldBackfill(db, () => {});

    expect(report.filled).toEqual({ 'Donation.guestEmail': 1 });
    expect(readDonationGuestEmail(tables['"Donation"']![0] as never)).toBe('guest@email.com');
  });

  it('gives the same email the same lookup, so matching survives the backfill', async () => {
    const { db, tables } = inMemoryDatabase({
      users: [unsealedUser('u1', 'Andi@Email.com'), unsealedUser('u2', 'ANDI@email.com ')],
    });

    await runContactFieldBackfill(db, () => {});

    expect(tables['"User"']![0]!.emailHmac).toBe(tables['"User"']![1]!.emailHmac);
  });

  it('pages through every row, however many there are', async () => {
    const { db, tables } = inMemoryDatabase({
      users: Array.from({ length: 25 }, (_, i) => unsealedUser(`u${String(i).padStart(2, '0')}`, `donor${i}@example.test`)),
    });

    const report = await runContactFieldBackfill(db, () => {}, { pageSize: 10 });

    expect(report.filled['User.email']).toBe(25);
    expect(tables['"User"']!.every((row) => row.emailCiphertext !== null)).toBe(true);
  });

  it('fills a bank account number, which the expand step left NULL on seeded rows', async () => {
    const { db, tables } = inMemoryDatabase({
      bankAccounts: [
        {
          id: 'b1',
          accountNumber: '1234567890',
          accountNumberCiphertext: null,
          accountNumberKeyId: null,
        } as unknown as Row,
      ],
    });

    const report = await runContactFieldBackfill(db, () => {});

    expect(report.filled).toEqual({ 'BankAccount.accountNumber': 1 });
    expect(tables['"BankAccount"']![0]!.accountNumberCiphertext).not.toBeNull();
  });

  it('leaves a row with no plaintext at all alone, rather than sealing a guess', async () => {
    const { db, writes } = inMemoryDatabase({ users: [unsealedUser('u1', 'andi@email.com', null)] });

    const report = await runContactFieldBackfill(db, () => {});

    expect(report.filled).toEqual({ 'User.email': 1 });
    expect(writes()).toBe(1);
  });
});

describe('when a row cannot be backfilled', () => {
  it('stops, names the row, and leaves the rest for a second run', async () => {
    const { db, tables, writes } = inMemoryDatabase({
      users: [unsealedUser('u1', 'andi@email.com'), unsealedUser('u2', 'broken@email.com')],
    });
    const failing: BackfillDatabase = {
      query: db.query,
      async execute(sql, values) {
        if ((values as [string])[0] === 'u2') throw new Error('connection reset');
        return db.execute(sql, values);
      },
    };

    await expect(runContactFieldBackfill(failing, () => {})).rejects.toThrow(/User\.email on "User" u2/);
    // The first row was committed, so a re-run starts from where this stopped
    // rather than from the beginning.
    expect(writes()).toBe(1);
    expect(tables['"User"']![0]!.emailCiphertext).not.toBeNull();
    expect(tables['"User"']![1]!.emailCiphertext).toBeNull();
  });

  it('refuses a plaintext column that is not text, rather than sealing "undefined"', async () => {
    const { db } = inMemoryDatabase({
      users: [{ ...unsealedUser('u1', 'andi@email.com'), email: 42 as unknown as string }],
    });

    await expect(runContactFieldBackfill(db, () => {})).rejects.toThrow(/not text/);
  });
});

describe('the keys', () => {
  it('are required before any row is touched', async () => {
    const saved = { ...process.env };
    for (const name of ['FIELD_ENCRYPTION_KEY', 'FIELD_ENCRYPTION_KEY_ID', 'FIELD_HMAC_KEY', 'FIELD_HMAC_KEY_ID']) {
      delete process.env[name];
    }
    const { db, writes } = inMemoryDatabase({ users: [unsealedUser('u1', 'andi@email.com')] });

    try {
      await expect(runContactFieldBackfill(db, () => {})).rejects.toThrow(/FIELD_ENCRYPTION_KEY/);
      expect(writes()).toBe(0);
    } finally {
      Object.assign(process.env, saved);
    }
  });
});
