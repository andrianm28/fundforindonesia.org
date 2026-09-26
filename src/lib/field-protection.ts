import type { PrismaClient } from '@/generated/prisma/client';
import { loadFieldKeys, type FieldKeys } from './field-encryption';

/**
 * Makes every User and BankAccount write carry the protected forms of the
 * contact details next to the plaintext, as ADR 0012 lays out:
 *
 * - `email` also gets `emailHmac` (searchable, keyed HMAC of the normalized
 *   address) and `emailCiphertext` (randomized AES-256-GCM), each with a key id.
 * - `phone` and `BankAccount.accountNumber` get a randomized ciphertext and a
 *   key id. They are never searched, so they get no HMAC.
 * - `name` and `BankAccount.accountName` stay plaintext by decision: names are
 *   shown publicly and Refund compares the holder name.
 *
 * This is the expand step: the plaintext is still written and still read.
 * Hooking the client rather than each route means the Auth.js adapter's
 * `createUser`, the seed and any later writer are covered without knowing
 * about it. Nested writes (a BankAccount created inside a User write) are not
 * seen; none exist today.
 */

/**
 * The client with the hooks installed, keys read from env. Read at client
 * construction so a half-configured key set fails the boot, not the first
 * registration.
 */
export function withContactFieldProtection(client: PrismaClient): PrismaClient {
  return client.$extends({
    name: 'contactFieldProtection',
    // The hooks are typed loosely (they only touch `data`, `create` and
    // `update`); Prisma's per-model argument types add nothing here.
    query: contactFieldWrites(loadFieldKeys(process.env)) as never,
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

/** Query-extension hooks for `client.$extends({ query })`. Null keys: pass-through. */
export function contactFieldWrites(keys: FieldKeys | null): {
  user: ModelHooks;
  bankAccount: ModelHooks;
} {
  return {
    user: hooksFor(keys ? (data) => protectUser(keys, data) : null),
    bankAccount: hooksFor(keys ? (data) => protectBankAccount(keys, data) : null),
  };
}

function hooksFor(protect: ((data: Data) => Data) | null): ModelHooks {
  const pass: Hook = ({ args, query }) => query(args);
  const withData: Hook = protect
    ? ({ args, query }) => query({ ...args, data: protectEach(protect, args.data) })
    : pass;
  const upsert: Hook = protect
    ? ({ args, query }) =>
        query({
          ...args,
          create: protectEach(protect, args.create),
          update: protectEach(protect, args.update),
        })
    : pass;
  const hooks = Object.fromEntries(DATA_OPERATIONS.map((op) => [op, withData]));
  return { ...hooks, upsert } as ModelHooks;
}

function protectEach(protect: (data: Data) => Data, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((row) => protectEach(protect, row));
  if (data && typeof data === 'object') return protect(data as Data);
  return data;
}

function protectUser(keys: FieldKeys, data: Data): Data {
  const out: Data = { ...data };

  const email = scalarWrite(data.email);
  if (typeof email === 'string') {
    const lookup = keys.emailLookup(email);
    const sealed = keys.encrypt('User.email', email);
    out.emailHmac = lookup.hmac;
    out.emailHmacKeyId = lookup.keyId;
    out.emailCiphertext = sealed.ciphertext;
    out.emailKeyId = sealed.keyId;
  }

  Object.assign(out, sealOptional(keys, 'User.phone', 'phone', scalarWrite(data.phone)));
  return out;
}

function protectBankAccount(keys: FieldKeys, data: Data): Data {
  return {
    ...data,
    ...sealOptional(keys, 'BankAccount.accountNumber', 'accountNumber', scalarWrite(data.accountNumber)),
  };
}

/** The ciphertext and key id columns for a nullable field; clears both when it is cleared. */
function sealOptional(keys: FieldKeys, field: string, column: string, value: unknown): Data {
  if (value === null) return { [`${column}Ciphertext`]: null, [`${column}KeyId`]: null };
  if (typeof value !== 'string') return {};
  const sealed = keys.encrypt(field, value);
  return { [`${column}Ciphertext`]: sealed.ciphertext, [`${column}KeyId`]: sealed.keyId };
}

/** The value a write sets, whether given bare or as Prisma's `{ set: value }`. */
function scalarWrite(value: unknown): unknown {
  if (value && typeof value === 'object' && 'set' in value) return (value as { set: unknown }).set;
  return value;
}
