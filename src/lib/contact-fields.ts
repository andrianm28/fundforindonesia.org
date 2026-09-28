import { loadFieldKeys, type FieldKeys } from './field-encryption';

/**
 * The contact details ADR 0012 protects, through one seam every writer and
 * every reader uses (prd-compliance 16, the contract step).
 *
 * The expand step (prd-compliance 15) wrote the protected forms beside the
 * plaintext and left the plaintext to be read. This step drops the plaintext
 * columns, so a writer has nowhere to put the value it holds and a reader has
 * nothing to read. Both go through here: `seal*` for a write, `read*` for a
 * row, `lookup*` for a filter, and the `SELECT_*` fragments to ask for the two
 * columns a read needs.
 *
 * What each field gets, and why, is ADR 0012's and does not change here:
 * email is stored twice, as a searchable keyed HMAC and as a randomized
 * ciphertext; phone and bank account number are a randomized ciphertext and are
 * never searched, so they get no HMAC; name stays plaintext, because it is
 * already shown publicly and because Refund compares the holder name.
 *
 * What this defends against, stated plainly because it is easy to overstate: a
 * stolen database dump. An Admin with panel access can still read every one of
 * these values, since this module decrypts them for the panel on the way out.
 * An access log on the panel does not exist and is separate work.
 *
 * `model` and `column` are the name the field had while the plaintext column
 * existed, kept because they are the additional authenticated data a
 * ciphertext is sealed with. That string is in every row already written; moving
 * one would invalidate all of them, so the table fixes it (the "reads what the
 * expand step sealed" test below names them).
 */

/** One protected field: the columns it is written to and read from. */
type ContactField = {
  /** The model the field is on, and its column name: `Model.column` is the AAD. */
  readonly model: string;
  readonly column: string;
  /** base64(iv | AES-256-GCM ciphertext | tag). */
  readonly sealed: string;
  /** Which key sealed it, so rotation is possible without a flag day. */
  readonly keyId: string;
  /** The searchable HMAC, and the key it was computed under. Absent when never searched. */
  readonly lookup?: string;
  readonly lookupKeyId?: string;
};

const USER_EMAIL: ContactField = {
  model: 'User',
  column: 'email',
  sealed: 'emailCiphertext',
  keyId: 'emailKeyId',
  lookup: 'emailHmac',
  lookupKeyId: 'emailHmacKeyId',
};
const USER_PHONE: ContactField = { model: 'User', column: 'phone', sealed: 'phoneCiphertext', keyId: 'phoneKeyId' };
const BANK_ACCOUNT_NUMBER: ContactField = {
  model: 'BankAccount',
  column: 'accountNumber',
  sealed: 'accountNumberCiphertext',
  keyId: 'accountNumberKeyId',
};
const REFUND_DONOR_ACCOUNT_NUMBER: ContactField = {
  model: 'Refund',
  column: 'donorAccountNumber',
  sealed: 'donorAccountNumberCiphertext',
  keyId: 'donorAccountNumberKeyId',
};
const GUEST_EMAIL: ContactField = {
  model: 'Donation',
  column: 'guestEmail',
  sealed: 'guestEmailCiphertext',
  keyId: 'guestEmailKeyId',
  lookup: 'guestEmailHmac',
  lookupKeyId: 'guestEmailHmacKeyId',
};
const GUEST_PHONE: ContactField = {
  model: 'Donation',
  column: 'guestPhone',
  sealed: 'guestPhoneCiphertext',
  keyId: 'guestPhoneKeyId',
};
const CONTACT_EMAIL: ContactField = {
  model: 'PartnershipInquiry',
  column: 'contactEmail',
  sealed: 'contactEmailCiphertext',
  keyId: 'contactEmailKeyId',
  lookup: 'contactEmailHmac',
  lookupKeyId: 'contactEmailHmacKeyId',
};
const CONTACT_PHONE: ContactField = {
  model: 'PartnershipInquiry',
  column: 'contactPhone',
  sealed: 'contactPhoneCiphertext',
  keyId: 'contactPhoneKeyId',
};

type Data = Record<string, unknown>;

/** The two columns a ciphertext is read from, for a field a row may not have. */
type Sealed<C extends string, K extends string> = { [P in C | K]: string | null };

/** The same two, for a field every row has. */
type SealedRequired<C extends string, K extends string> = { [P in C | K]: string };

/** An email's four: a searchable lookup HMAC and key id beside a ciphertext and key id. */
type SealedEmail<L extends string, LK extends string, C extends string, K extends string> = {
  [P in L | LK | C | K]: string;
};

/** The same two lookup columns, for a filter rather than a write. */
type Lookup<L extends string, LK extends string> = { [P in L | LK]: string };

/**
 * The keys, or a failure.
 *
 * The expand step returned null here and let a deployment without keys keep
 * writing plaintext only. There is no plaintext left to fall back on, so a
 * missing key is not a degraded mode any more: it is a value that cannot be
 * written or read at all, and it is raised where it happens rather than
 * silently dropped.
 */
export function requireFieldKeys(): FieldKeys {
  const keys = loadFieldKeys(process.env);
  if (!keys) {
    throw new Error(
      'Field encryption is not configured: FIELD_ENCRYPTION_KEY, FIELD_ENCRYPTION_KEY_ID, FIELD_HMAC_KEY and FIELD_HMAC_KEY_ID must all be set (ADR 0012). Contact details have no plaintext column to fall back on.',
    );
  }
  return keys;
}

function seal(field: ContactField, value: string | null): Data {
  if (value === null) return { [field.sealed]: null, [field.keyId]: null };
  const keys = requireFieldKeys();
  const ciphertext = keys.encrypt(aad(field), value);
  return { [field.sealed]: ciphertext.ciphertext, [field.keyId]: ciphertext.keyId };
}

function sealEmail(field: ContactField, email: string): Data {
  const keys = requireFieldKeys();
  const lookup = keys.emailLookup(email);
  return {
    [field.lookup!]: lookup.hmac,
    [field.lookupKeyId!]: lookup.keyId,
    ...seal(field, email),
  };
}

function read(field: ContactField, row: Data): string | null {
  const ciphertext = row[field.sealed];
  if (typeof ciphertext !== 'string') return null;
  return requireFieldKeys().decrypt(aad(field), { ciphertext, keyId: String(row[field.keyId]) });
}

function lookup(field: ContactField, email: string): Data {
  const keys = requireFieldKeys();
  const found = keys.emailLookup(email);
  return { [field.lookup!]: found.hmac, [field.lookupKeyId!]: found.keyId };
}

/** The additional authenticated data a ciphertext is bound to. Never changes. */
function aad(field: ContactField): string {
  return `${field.model}.${field.column}`;
}

// --- User ---------------------------------------------------------------------

/** The columns a write of a Donor's account email carries. */
export function sealUserEmail(email: string): SealedEmail<'emailHmac', 'emailHmacKeyId', 'emailCiphertext', 'emailKeyId'> {
  return sealEmail(USER_EMAIL, email) as ReturnType<typeof sealUserEmail>;
}
export function sealUserPhone(phone: string | null): Sealed<'phoneCiphertext', 'phoneKeyId'> {
  return seal(USER_PHONE, phone) as Sealed<'phoneCiphertext', 'phoneKeyId'>;
}
export function readUserEmail(row: Sealed<'emailCiphertext', 'emailKeyId'>): string | null {
  return read(USER_EMAIL, row);
}
export function readUserPhone(row: Sealed<'phoneCiphertext', 'phoneKeyId'>): string | null {
  return read(USER_PHONE, row);
}
/** The filter that finds the account with this email: its HMAC, never a scan. */
export function lookupUserEmail(email: string): Lookup<'emailHmac', 'emailHmacKeyId'> {
  return lookup(USER_EMAIL, email) as Lookup<'emailHmac', 'emailHmacKeyId'>;
}

/** The two columns a User email read needs, for a `select`. */
export const SELECT_USER_EMAIL = { emailCiphertext: true, emailKeyId: true } as const;
export const SELECT_USER_PHONE = { phoneCiphertext: true, phoneKeyId: true } as const;

// --- BankAccount --------------------------------------------------------------

export function sealBankAccountNumber(accountNumber: string): SealedRequired<'accountNumberCiphertext', 'accountNumberKeyId'> {
  return seal(BANK_ACCOUNT_NUMBER, accountNumber) as ReturnType<typeof sealBankAccountNumber>;
}
export function readBankAccountNumber(row: Sealed<'accountNumberCiphertext', 'accountNumberKeyId'>): string | null {
  return read(BANK_ACCOUNT_NUMBER, row);
}
export const SELECT_BANK_ACCOUNT_NUMBER = {
  accountNumberCiphertext: true,
  accountNumberKeyId: true,
} as const;

// --- Refund (a Donor's destination account, recorded at approval) ------------

/**
 * The Donor's destination account (ticket 31; CONTEXT.md, Refund; ADR
 * 0012): the same field encryption as BankAccount.accountNumber (same
 * `seal`/`read` plumbing, same key material), sealed under its own AAD
 * ("Refund.donorAccountNumber") so a ciphertext copied from one column to
 * the other fails to decrypt rather than silently reading as the wrong
 * donor's number. There is no saved BankAccount row for a Donor -- the
 * approving Admin records the destination, and the completing Admin re-types
 * the number to be compared (ADR 0018, Amendment 2026-09-28) -- so this is
 * its own field, not a reuse of BankAccount's.
 */
export function sealRefundDonorAccountNumber(
  accountNumber: string,
): SealedRequired<'donorAccountNumberCiphertext', 'donorAccountNumberKeyId'> {
  return seal(REFUND_DONOR_ACCOUNT_NUMBER, accountNumber) as ReturnType<typeof sealRefundDonorAccountNumber>;
}
export function readRefundDonorAccountNumber(
  row: Sealed<'donorAccountNumberCiphertext', 'donorAccountNumberKeyId'>,
): string | null {
  return read(REFUND_DONOR_ACCOUNT_NUMBER, row);
}
export const SELECT_REFUND_DONOR_ACCOUNT_NUMBER = {
  donorAccountNumberCiphertext: true,
  donorAccountNumberKeyId: true,
} as const;

// --- Donation (a Guest Donor's contact details) --------------------------------

export function sealDonationGuestEmail(
  email: string,
): SealedEmail<'guestEmailHmac', 'guestEmailHmacKeyId', 'guestEmailCiphertext', 'guestEmailKeyId'> {
  return sealEmail(GUEST_EMAIL, email) as ReturnType<typeof sealDonationGuestEmail>;
}
export function sealDonationGuestPhone(phone: string | null): Sealed<'guestPhoneCiphertext', 'guestPhoneKeyId'> {
  return seal(GUEST_PHONE, phone) as Sealed<'guestPhoneCiphertext', 'guestPhoneKeyId'>;
}
export function readDonationGuestEmail(row: Sealed<'guestEmailCiphertext', 'guestEmailKeyId'>): string | null {
  return read(GUEST_EMAIL, row);
}
export function readDonationGuestPhone(row: Sealed<'guestPhoneCiphertext', 'guestPhoneKeyId'>): string | null {
  return read(GUEST_PHONE, row);
}
export function lookupDonationGuestEmail(email: string): Lookup<'guestEmailHmac', 'guestEmailHmacKeyId'> {
  return lookup(GUEST_EMAIL, email) as Lookup<'guestEmailHmac', 'guestEmailHmacKeyId'>;
}
export const SELECT_DONATION_GUEST_EMAIL = { guestEmailCiphertext: true, guestEmailKeyId: true } as const;

// --- PartnershipInquiry (a company's named contact) ----------------------------

export function sealInquiryContactEmail(
  email: string,
): SealedEmail<'contactEmailHmac', 'contactEmailHmacKeyId', 'contactEmailCiphertext', 'contactEmailKeyId'> {
  return sealEmail(CONTACT_EMAIL, email) as ReturnType<typeof sealInquiryContactEmail>;
}
export function sealInquiryContactPhone(phone: string | null): Sealed<'contactPhoneCiphertext', 'contactPhoneKeyId'> {
  return seal(CONTACT_PHONE, phone) as Sealed<'contactPhoneCiphertext', 'contactPhoneKeyId'>;
}
export function readInquiryContactEmail(row: Sealed<'contactEmailCiphertext', 'contactEmailKeyId'>): string | null {
  return read(CONTACT_EMAIL, row);
}
export function readInquiryContactPhone(row: Sealed<'contactPhoneCiphertext', 'contactPhoneKeyId'>): string | null {
  return read(CONTACT_PHONE, row);
}
export function lookupInquiryContactEmail(email: string): Lookup<'contactEmailHmac', 'contactEmailHmacKeyId'> {
  return lookup(CONTACT_EMAIL, email) as Lookup<'contactEmailHmac', 'contactEmailHmacKeyId'>;
}
export const SELECT_INQUIRY_CONTACT_EMAIL = { contactEmailCiphertext: true, contactEmailKeyId: true } as const;
