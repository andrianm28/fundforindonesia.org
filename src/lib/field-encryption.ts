import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Field-level protection for Donor and Fundraiser contact details (ADR 0012).
 */

export type SealedField = { ciphertext: string; keyId: string };

export type EmailLookup = { hmac: string; keyId: string };

export type FieldKeys = {
  emailLookup(email: string): EmailLookup;
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

/**
 * Reads the two secrets and their key ids from env.
 *
 * Returns null when none is set: this is the expand step, so a deployment
 * without keys keeps writing plaintext only and the backfill fills the new
 * columns later. Anything in between (some set, a key of the wrong size, one
 * secret used for both jobs) throws, because a half-configured scheme would
 * write data nobody can read back.
 */
export function loadFieldKeys(env: Record<string, string | undefined>): FieldKeys | null {
  const set = VARS.filter((name) => env[name]);
  if (set.length === 0) return null;
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

  return {
    emailLookup(email) {
      const hmac = createHmac('sha256', hmacKey).update(normalizeEmail(email), 'utf8').digest('hex');
      return { hmac, keyId: hmacKeyId };
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
      if (sealed.keyId !== encKeyId) {
        throw new Error(`No field encryption key with id "${sealed.keyId}" is configured`);
      }
      const raw = Buffer.from(sealed.ciphertext, 'base64');
      if (raw.length < IV_BYTES + TAG_BYTES) {
        throw new Error(`Ciphertext for ${field} is too short to be sealed data`);
      }
      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(raw.length - TAG_BYTES);
      const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
      decipher.setAAD(Buffer.from(field, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    },
  };
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
