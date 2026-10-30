import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Field-level protection for Donor and Fundraiser contact details (ADR 0012).
 */

export type SealedField = { ciphertext: string; keyId: string };

export type EmailLookup = { hmac: string; keyId: string };

export type FieldKeys = {
  /** The lookup under the current HMAC key: the only one that is ever written. */
  emailLookup(email: string): EmailLookup;
  /** One lookup per configured HMAC key, current first: what a filter must match, so rows hashed before a rotation are still found. */
  emailLookups(email: string): EmailLookup[];
  encrypt(field: string, plaintext: string): SealedField;
  decrypt(field: string, sealed: SealedField): string;
};

const IV_BYTES = 12;
const TAG_BYTES = 16;

const KEY_BYTES = 32;

const VARS = [
  'FIELD_ENCRYPTION_KEY',
  'FIELD_ENCRYPTION_KEY_ID',
  'FIELD_HMAC_KEY',
  'FIELD_HMAC_KEY_ID',
] as const;

const PREVIOUS_ENCRYPTION = 'FIELD_ENCRYPTION_PREVIOUS_KEYS';
const PREVIOUS_HMAC = 'FIELD_HMAC_PREVIOUS_KEYS';

type KeyEntry = { id: string; key: Buffer };

/**
 * Reads the two secrets and their key ids from env, plus any retired keys.
 *
 * Returns null when none is set: this is the expand step, so a deployment
 * without keys keeps writing plaintext only and the backfill fills the new
 * columns later. Anything in between (some set, a key of the wrong size, one
 * secret used for both jobs) throws, because a half-configured scheme would
 * write data nobody can read back.
 *
 * Rotation (ADR 0012): FIELD_ENCRYPTION_PREVIOUS_KEYS and
 * FIELD_HMAC_PREVIOUS_KEYS are comma-separated `id:base64key` lists of retired
 * keys. They are only ever read with: encrypt and the written lookup use the
 * current key, decrypt picks the key by the stored id, and a filter matches
 * every HMAC key.
 */
export function loadFieldKeys(env: Record<string, string | undefined>): FieldKeys | null {
  const set = VARS.filter((name) => env[name]);
  if (set.length === 0) {
    const retired = [PREVIOUS_ENCRYPTION, PREVIOUS_HMAC].filter((name) => env[name]);
    if (retired.length > 0) {
      throw new Error(`${retired.join(', ')} set but no current field key is: retired keys alone decrypt nothing new`);
    }
    return null;
  }
  const missing = VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Field encryption is half-configured: ${missing.join(', ')} unset while ${set.join(', ')} set`,
    );
  }

  const encKey = decodeKey('FIELD_ENCRYPTION_KEY', env.FIELD_ENCRYPTION_KEY!);
  const encKeyId = env.FIELD_ENCRYPTION_KEY_ID!;
  const hmacKey = decodeKey('FIELD_HMAC_KEY', env.FIELD_HMAC_KEY!);
  const hmacKeyId = env.FIELD_HMAC_KEY_ID!;
  if (encKey.equals(hmacKey)) {
    throw new Error('FIELD_ENCRYPTION_KEY and FIELD_HMAC_KEY must be separate secrets (ADR 0012)');
  }
  if (encKeyId === hmacKeyId) {
    throw new Error('FIELD_ENCRYPTION_KEY_ID and FIELD_HMAC_KEY_ID must differ: a key id names one key');
  }

  const encKeys: KeyEntry[] = [
    { id: encKeyId, key: encKey },
    ...parseRetired(PREVIOUS_ENCRYPTION, env[PREVIOUS_ENCRYPTION]),
  ];
  const hmacKeys: KeyEntry[] = [
    { id: hmacKeyId, key: hmacKey },
    ...parseRetired(PREVIOUS_HMAC, env[PREVIOUS_HMAC]),
  ];
  assertUnique(PREVIOUS_ENCRYPTION, encKeys);
  assertUnique(PREVIOUS_HMAC, hmacKeys);
  for (const e of encKeys) {
    for (const h of hmacKeys) {
      if (e.id === h.id) {
        throw new Error(
          `${PREVIOUS_ENCRYPTION}, ${PREVIOUS_HMAC} and the current key ids must differ: an encryption key id and an HMAC key id are equal`,
        );
      }
      if (e.key.equals(h.key)) {
        throw new Error(
          `${PREVIOUS_ENCRYPTION}, ${PREVIOUS_HMAC} and the current keys must be separate secrets (ADR 0012): an encryption key is also an HMAC key`,
        );
      }
    }
  }

  const lookupWith = (entry: KeyEntry, email: string): EmailLookup => ({
    hmac: createHmac('sha256', entry.key).update(normalizeEmail(email), 'utf8').digest('hex'),
    keyId: entry.id,
  });

  return {
    emailLookup(email) {
      return lookupWith(hmacKeys[0], email);
    },
    emailLookups(email) {
      return hmacKeys.map((entry) => lookupWith(entry, email));
    },
    encrypt(field, plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', encKey, iv);
      cipher.setAAD(Buffer.from(field, 'utf8'));
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return { ciphertext: Buffer.concat([iv, body, tag]).toString('base64'), keyId: encKeyId };
    },
    decrypt(field, sealed) {
      const entry = encKeys.find((k) => k.id === sealed.keyId);
      if (!entry) {
        throw new Error(`No field encryption key with id "${sealed.keyId}" is configured`);
      }
      const raw = Buffer.from(sealed.ciphertext, 'base64');
      if (raw.length < IV_BYTES + TAG_BYTES) {
        throw new Error(`Ciphertext for ${field} is too short to be sealed data`);
      }
      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(raw.length - TAG_BYTES);
      const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', entry.key, iv);
      decipher.setAAD(Buffer.from(field, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    },
  };
}

/** Parses `id:base64key,id:base64key`. Errors name the variable and position, never the entry. */
function parseRetired(name: string, raw: string | undefined): KeyEntry[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const colon = part.indexOf(':');
      const id = colon > 0 ? part.slice(0, colon).trim() : '';
      const value = colon > 0 ? part.slice(colon + 1).trim() : '';
      if (!id || !value) {
        throw new Error(`${name} entry ${index + 1} must look like id:base64key`);
      }
      return { id, key: decodeKey(`${name} entry ${index + 1}`, value) };
    });
}

/** Current id first, then the retired ones: any repeat would make a stored id name two keys. */
function assertUnique(name: string, entries: KeyEntry[]): void {
  const seen = new Set<string>();
  for (const { id } of entries) {
    if (seen.has(id)) {
      throw new Error(`${name} key ids must be unique, and differ from the current key id: "${id}" repeats`);
    }
    seen.add(id);
  }
}

function decodeKey(name: string, value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${name} must be ${KEY_BYTES} bytes of base64 (openssl rand -base64 32), got ${key.length} bytes`,
    );
  }
  return key;
}

/** Trimmed and lowercased, so a lookup finds the Donor however they typed it. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
