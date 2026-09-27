import type { PrismaClient } from '@/generated/prisma/client';
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
 * Makes every User, BankAccount, Donation and PartnershipInquiry write carry
 * only the protected form of a contact detail, as ADR 0012 lays out:
 *
 * - `email` also gets `emailHmac` (searchable, keyed HMAC of the normalized
 *   address) and `emailCiphertext` (randomized AES-256-GCM), each with a key id.
 * - `phone` and `BankAccount.accountNumber` get a randomized ciphertext and a
 *   key id. They are never searched, so they get no HMAC.
 * - `name`, `BankAccount.accountName` and `Donation.guestName` stay plaintext
 *   by decision: names are shown publicly and Refund compares the holder name.
 * - `Donation.guestEmail`/`guestPhone` (a Guest Donor's contact details,
 *   CONTEXT.md Guest Donor) and `PartnershipInquiry.contactEmail`/
 *   `contactPhone` (the named person at a company asking about a Program) are
 *   the same contact data and get the same treatment.
 *
 * The plaintext columns are gone (prd-compliance 16, the contract step), so
 * this hook no longer stores both forms: it seals the plaintext a caller hands
 * it and drops the plaintext, which is what keeps a route, the seed or the
 * Auth.js adapter from storing a contact detail in the clear even by accident.
 * Application code seals at the call site instead, through
 * src/lib/contact-fields.ts; this is the boundary that catches whatever is
 * left, including the third-party adapter's `createUser`, which cannot be told
 * about the schema.
 *
 * Nested writes are still not seen, and that is no longer a silent risk: a
 * nested `create` that tried to pass a contact detail would name a column the
 * database does not have, and Prisma would refuse it.
 */

/**
 * The client with the hooks installed, keys read from env.
 *
 * The keys are resolved once, here, and a write that carries a contact detail
 * is refused when there are none. That refusal is at the write rather than at
 * the boot, because a deployment with no keys can still serve every page that
 * touches no contact detail -- and with the plaintext columns gone it cannot
 * serve one that does, which is the honest outcome rather than a silent NULL.
 */
export function withContactFieldProtection(client: PrismaClient): PrismaClient {
  return client.$extends({
    name: 'contactFieldProtection',
    // The hooks are typed loosely (they only touch `data`, `create` and
    // `update`); Prisma's per-model argument types add nothing here.
    query: contactFieldWrites() as never,
  }) as unknown as PrismaClient;
}

type Data = Record<string, unknown>;
type Args = Record<string, unknown>;
type Hook = (params: { args: Args; query: (args: Args) => Promise<unknown> }) => Promise<unknown>;

/** Every operation that takes its values in `data`; `upsert` is handled apart. */
const DATA_OPERATIONS = [
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
] as const;
type ModelHooks = Record<(typeof DATA_OPERATIONS)[number] | 'upsert', Hook>;

/**
 * Query-extension hooks for `client.$extends({ query })`.
 *
 * A null `keys` refuses a write that carries a contact detail instead of
 * passing it through: the caller meant to store an address, and the only
 * remaining way to do that is protected.
 */
export function contactFieldWrites(keys: ReturnType<typeof loadKeys> = loadKeys()): {
  user: ModelHooks;
  bankAccount: ModelHooks;
  donation: ModelHooks;
  partnershipInquiry: ModelHooks;
} {
  return {
    user: hooksFor((data) => protect(keys, 'user', data)),
    bankAccount: hooksFor((data) => protect(keys, 'bankAccount', data)),
    donation: hooksFor((data) => protect(keys, 'donation', data)),
    partnershipInquiry: hooksFor((data) => protect(keys, 'partnershipInquiry', data)),
  };
}

/**
 * The keys a write seals with, or null when the environment has none. Not
 * `requireFieldKeys`: a write that carries no contact detail must still work on
 * a deployment mid-migration, and the seal is where a missing key is refused.
 */
function loadKeys() {
  try {
    return requireFieldKeys();
  } catch {
    return null;
  }
}

function hooksFor(protect: (data: Data) => Data): ModelHooks {
  const withData: Hook = ({ args, query }) => query({ ...args, data: protectEach(protect, args.data) });
  const upsert: Hook = ({ args, query }) =>
    query({
      ...args,
      create: protectEach(protect, args.create),
      update: protectEach(protect, args.update),
    });
  const hooks = Object.fromEntries(DATA_OPERATIONS.map((op) => [op, withData]));
  return { ...hooks, upsert } as ModelHooks;
}

function protectEach(protect: (data: Data) => Data, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((row) => protectEach(protect, row));
  if (data && typeof data === 'object') return protect(data as Data);
  return data;
}

/**
 * Which contact fields each model has, and the seal for each. The names are the
 * columns those fields were written to while the plaintext existed, which is
 * also the additional authenticated data they are encrypted under: a ciphertext
 * already in the database decrypts only under the name it was sealed with, so
 * these are fixed (see src/lib/contact-fields.ts, which readers use and which
 * holds the same table).
 */
const FIELDS = {
  user: {
    email: sealUserEmail,
    phone: sealUserPhone,
  },
  bankAccount: {
    accountNumber: sealBankAccountNumber,
  },
  donation: {
    guestEmail: sealDonationGuestEmail,
    guestPhone: sealDonationGuestPhone,
  },
  partnershipInquiry: {
    contactEmail: sealInquiryContactEmail,
    contactPhone: sealInquiryContactPhone,
  },
} as const;

type Model = keyof typeof FIELDS;

/** Every seal in the table, as one callable shape: a plaintext in, columns out. */
type Sealer = (value: string | null) => Data;

function protect(keys: ReturnType<typeof loadKeys>, model: Model, data: Data): Data {
  const out: Data = { ...data };
  const fields = FIELDS[model] as Record<string, Sealer>;

  for (const [column, seal] of Object.entries(fields)) {
    if (!(column in data)) continue;
    const value = scalarWrite(data[column]);
    if (!keys) {
      throw new Error(
        `Cannot store ${model}.${column}: field encryption is not configured, and the plaintext column is gone (ADR 0012). Set FIELD_ENCRYPTION_KEY, FIELD_ENCRYPTION_KEY_ID, FIELD_HMAC_KEY and FIELD_HMAC_KEY_ID.`,
      );
    }
    delete out[column];
    Object.assign(out, seal(typeof value === 'string' ? value : null));
  }

  return out;
}

/** The value a write sets, whether given bare or as Prisma's `{ set: value }`. */
function scalarWrite(value: unknown): unknown {
  if (value && typeof value === 'object' && 'set' in value) return (value as { set: unknown }).set;
  return value;
}
