import {
  requireFieldKeys,
  sealBankAccountNumber,
  sealDonationGuestEmail,
  sealDonationGuestPhone,
  sealInquiryContactEmail,
  sealInquiryContactPhone,
  sealUserEmail,
  sealUserPhone,
} from './contact-fields';

/**
 * Fills the protected columns ADR 0012 added, for every row written before the
 * keys were configured (prd-compliance 16, the contract step).
 *
 * The expand migration left those columns NULL on purpose, beside the plaintext
 * they were to protect, so a deployment without keys kept working. The contract
 * migration drops the plaintext, and it cannot do that while a row still has
 * NULL where its value should be -- there would be nothing left to read. This
 * is what runs in between, and it is a script rather than part of the migration
 * for two reasons: it needs FIELD_ENCRYPTION_KEY and FIELD_HMAC_KEY, which a
 * SQL migration has no way to reach, and it may be long enough on a large
 * database that the owner wants to run it, watch it, and re-run it.
 *
 * It reads the plaintext with raw SQL rather than through Prisma, and that is
 * not a shortcut. It runs against the schema as it is *before* the contract
 * migration, where the plaintext columns still exist and the generated client
 * in this working tree already does not have them: a `findMany` here would
 * return rows with no email in them and report that there was nothing to do,
 * which is the one outcome this script must never produce. The model and
 * column names below are the plaintext ones, quoted and fixed, and every value
 * is a bound parameter.
 *
 * Four properties make it safe to run twice, which is the only way it is
 * really run:
 *
 * - It selects only rows whose protected columns are not all filled, so it
 *   never re-encrypts a row that is already sealed and never disturbs a row
 *   the app has written since.
 * - It commits each row as it goes, so stopping at any point leaves the work
 *   done so far intact and the next run picks up from there.
 * - It stops at the first row it cannot seal, naming the row, rather than
 *   skipping it. A half-backfilled database that still looks complete is how
 *   contact details go missing quietly.
 * - It reports what it filled, and the migration's guard is the real check:
 *   this finishing is not what makes the drop safe.
 */

type Data = Record<string, unknown>;

/** What the owner reads when it is done: how many rows each field was filled on. */
export type BackfillReport = { filled: Record<string, number> };

/** One protected field of one model, as the backfill sees it. */
type BackfilledField = {
  /** The name the migration's guard and the runbook use for it. */
  readonly label: string;
  /** The table, and the plaintext column in it. */
  readonly table: string;
  readonly plaintext: string;
  /** Every column the seal writes; all of them NULL means "needs filling". */
  readonly sealed: readonly string[];
  readonly seal: (value: string) => Data;
};

const FIELDS: readonly BackfilledField[] = [
  {
    label: 'User.email',
    table: '"User"',
    plaintext: 'email',
    sealed: ['emailHmac', 'emailHmacKeyId', 'emailCiphertext', 'emailKeyId'],
    seal: sealUserEmail,
  },
  { label: 'User.phone', table: '"User"', plaintext: 'phone', sealed: ['phoneCiphertext', 'phoneKeyId'], seal: sealUserPhone },
  {
    label: 'BankAccount.accountNumber',
    table: '"BankAccount"',
    plaintext: 'accountNumber',
    sealed: ['accountNumberCiphertext', 'accountNumberKeyId'],
    seal: sealBankAccountNumber,
  },
  {
    label: 'Donation.guestEmail',
    table: '"Donation"',
    plaintext: 'guestEmail',
    sealed: ['guestEmailHmac', 'guestEmailHmacKeyId', 'guestEmailCiphertext', 'guestEmailKeyId'],
    seal: sealDonationGuestEmail,
  },
  {
    label: 'Donation.guestPhone',
    table: '"Donation"',
    plaintext: 'guestPhone',
    sealed: ['guestPhoneCiphertext', 'guestPhoneKeyId'],
    seal: sealDonationGuestPhone,
  },
  {
    label: 'PartnershipInquiry.contactEmail',
    table: '"PartnershipInquiry"',
    plaintext: 'contactEmail',
    sealed: ['contactEmailHmac', 'contactEmailHmacKeyId', 'contactEmailCiphertext', 'contactEmailKeyId'],
    seal: sealInquiryContactEmail,
  },
  {
    label: 'PartnershipInquiry.contactPhone',
    table: '"PartnershipInquiry"',
    plaintext: 'contactPhone',
    sealed: ['contactPhoneCiphertext', 'contactPhoneKeyId'],
    seal: sealInquiryContactPhone,
  },
];

const DEFAULT_PAGE_SIZE = 500;

/**
 * The database, as two bound-parameter calls.
 *
 * Deliberately not the Prisma client: see the note at the top of this file
 * about why this reads the plaintext columns directly.
 */
export type BackfillDatabase = {
  /** Rows of `{ id, <plaintext column> }`, ascending by id. */
  query(sql: string, values: unknown[]): Promise<Array<{ id: string } & Data>>;
  /** The number of rows the write touched. */
  execute(sql: string, values: unknown[]): Promise<number>;
};

/**
 * Fills every unsealed row and reports what it filled.
 *
 * `log` gets one line per page and the final tally, so the operator watching a
 * long run sees it move. A row that cannot be sealed throws, naming the model
 * and the row: the migration's guard would refuse the whole drop anyway, and a
 * backfill that finished while quietly skipping one would be worse than one
 * that stopped.
 */
export async function runContactFieldBackfill(
  db: BackfillDatabase,
  log: (message: string) => void = () => {},
  options: { pageSize?: number } = {},
): Promise<BackfillReport> {
  // Resolved before any row is touched, so a deployment with no keys stops
  // immediately instead of half-way through a page.
  requireFieldKeys();
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const filled: Record<string, number> = {};

  for (const field of FIELDS) {
    // Paged by an id cursor, not OFFSET: this updates rows while it reads them,
    // and OFFSET would skip rows as earlier ones drop out of the filter below.
    // The cursor cannot skip anything either, since ids only ever move forward
    // and a filled row is simply not returned again.
    const unsealed = field.sealed.map((column) => `"${column}" IS NULL`).join(' OR ');
    const select = `SELECT "id", "${field.plaintext}" AS "value" FROM ${field.table}
       WHERE "${field.plaintext}" IS NOT NULL AND (${unsealed}) AND "id" > $1
       ORDER BY "id" ASC LIMIT $2`;
    const update = `UPDATE ${field.table} SET ${field.sealed
      .map((column, i) => `"${column}" = $${i + 2}`)
      .join(', ')} WHERE "id" = $1`;
    let cursor = '';

    for (;;) {
      const rows = await db.query(select, [cursor, pageSize]);
      if (rows.length === 0) break;
      cursor = String(rows[rows.length - 1].id);

      for (const row of rows) {
        const value = row.value;
        if (typeof value !== 'string') {
          throw new Error(
            `Cannot backfill ${field.label} on ${field.table} ${row.id}: the plaintext column holds a ${typeof value}, not text. Nothing is lost and nothing was changed.`,
          );
        }
        // Column by name, not by the seal's own key order: the SET clause and
        // the values have to agree, and relying on an object literal's order to
        // line them up is a silent corruption waiting to happen.
        const sealed = field.seal(value);
        try {
          await db.execute(update, [row.id, ...field.sealed.map((column) => sealed[column])]);
        } catch (error) {
          throw new Error(
            `Cannot backfill ${field.label} on ${field.table} ${row.id}: ${(error as Error).message}. Nothing is lost: the plaintext column is still there, and re-running the backfill starts again from the first unsealed row.`,
            { cause: error },
          );
        }
        filled[field.label] = (filled[field.label] ?? 0) + 1;
      }

      log(`${field.table}.${field.plaintext}: through ${cursor} (${rows.length} rows)`);
    }
  }

  const tally = Object.entries(filled)
    .map(([field, count]) => `  ${field}: ${count}`)
    .join('\n');
  log(tally ? `Backfill complete:\n${tally}` : 'Backfill complete: nothing left to fill.');
  return { filled };
}

/** Binds a statement's values, and never its table or column names. */
export function boundQuery(unsafe: (sql: string, ...values: unknown[]) => Promise<unknown>) {
  return {
    query: <T>(sql: string, values: unknown[]) => unsafe(sql, ...values) as Promise<T[]>,
    execute: async (sql: string, values: unknown[]) => Number(await unsafe(sql, ...values)),
  };
}
