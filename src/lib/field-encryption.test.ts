// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadFieldKeys } from './field-encryption';

const env = (overrides: Record<string, string | undefined> = {}) => ({
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  FIELD_ENCRYPTION_KEY_ID: 'enc-test-1',
  FIELD_HMAC_KEY: randomBytes(32).toString('base64'),
  FIELD_HMAC_KEY_ID: 'hmac-test-1',
  ...overrides,
});

describe('loading the keys from env', () => {
  it('is off, not broken, when none of the four variables is set', () => {
    expect(loadFieldKeys({})).toBeNull();
    expect(
      loadFieldKeys({
        FIELD_ENCRYPTION_KEY: '',
        FIELD_ENCRYPTION_KEY_ID: '',
        FIELD_HMAC_KEY: '',
        FIELD_HMAC_KEY_ID: '',
      }),
    ).toBeNull();
  });

  it('refuses a half-configured set, naming what is missing', () => {
    expect(() => loadFieldKeys(env({ FIELD_HMAC_KEY_ID: undefined }))).toThrow(
      /FIELD_HMAC_KEY_ID/,
    );
    expect(() => loadFieldKeys(env({ FIELD_ENCRYPTION_KEY: '' }))).toThrow(
      /FIELD_ENCRYPTION_KEY\b/,
    );
  });

  it('refuses a key that is not 32 bytes of base64', () => {
    expect(() =>
      loadFieldKeys(env({ FIELD_ENCRYPTION_KEY: randomBytes(16).toString('base64') })),
    ).toThrow(/FIELD_ENCRYPTION_KEY.*32 bytes/);
    expect(() => loadFieldKeys(env({ FIELD_HMAC_KEY: 'not-a-key' }))).toThrow(
      /FIELD_HMAC_KEY.*32 bytes/,
    );
  });

  it('refuses one key id for both secrets, so a stored id always names one key', () => {
    expect(() =>
      loadFieldKeys(env({ FIELD_ENCRYPTION_KEY_ID: 'k1', FIELD_HMAC_KEY_ID: 'k1' })),
    ).toThrow(/key id/);
  });

  it('refuses the same secret for HMAC and encryption, since ADR 0012 makes them separate', () => {
    const shared = randomBytes(32).toString('base64');

    expect(() =>
      loadFieldKeys(env({ FIELD_ENCRYPTION_KEY: shared, FIELD_HMAC_KEY: shared })),
    ).toThrow(/separate/);
  });
});

describe('email lookup HMAC', () => {
  // Reference value, independent of this code:
  //   echo -n "andi@email.com" | openssl dgst -sha256 -hmac kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
  // KEY_OF_32_KS is that same 32-character key in base64.
  const KEY_OF_32_KS = 'a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=';

  it('is HMAC-SHA256 under the HMAC key of the normalized email, tagged with its key id', () => {
    const keys = loadFieldKeys(env({ FIELD_HMAC_KEY: KEY_OF_32_KS }))!;

    expect(keys.emailLookup('  Andi@Email.COM ')).toEqual({
      hmac: 'b6047d850665d57aefd9d124b4f4949ade9cd12815f6b235e328bf68dc121ec4',
      keyId: 'hmac-test-1',
    });
  });

  it('is keyed by the HMAC key, not the encryption key', () => {
    const encryptionKey = randomBytes(32).toString('base64');
    const a = loadFieldKeys(env({ FIELD_ENCRYPTION_KEY: encryptionKey }))!;
    const b = loadFieldKeys(env({ FIELD_ENCRYPTION_KEY: encryptionKey }))!;

    expect(a.emailLookup('andi@email.com').hmac).not.toBe(b.emailLookup('andi@email.com').hmac);
  });
});

describe('field encryption', () => {
  it('decrypts what it encrypted, and tags the ciphertext with the key id', () => {
    const keys = loadFieldKeys(env())!;

    const sealed = keys.encrypt('User.phone', '+6281234567890');

    expect(sealed.keyId).toBe('enc-test-1');
    expect(sealed.ciphertext).not.toContain('6281234567890');
    expect(keys.decrypt('User.phone', sealed)).toBe('+6281234567890');
  });

  it('is randomized: the same value never produces the same ciphertext twice', () => {
    const keys = loadFieldKeys(env())!;

    const a = keys.encrypt('BankAccount.accountNumber', '1234567890');
    const b = keys.encrypt('BankAccount.accountNumber', '1234567890');

    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('refuses a ciphertext moved to another field or altered', () => {
    const keys = loadFieldKeys(env())!;
    const sealed = keys.encrypt('User.phone', '+6281234567890');

    expect(() => keys.decrypt('BankAccount.accountNumber', sealed)).toThrow();

    const raw = Buffer.from(sealed.ciphertext, 'base64');
    raw[raw.length - 20] ^= 0x01;
    expect(() =>
      keys.decrypt('User.phone', { ...sealed, ciphertext: raw.toString('base64') }),
    ).toThrow();
  });

  it('refuses a truncated ciphertext with a plain message', () => {
    const keys = loadFieldKeys(env())!;

    expect(() =>
      keys.decrypt('User.phone', { ciphertext: 'c2hvcnQ=', keyId: 'enc-test-1' }),
    ).toThrow(/too short/);
  });

  it('refuses a ciphertext sealed under a key id it does not hold', () => {
    const keys = loadFieldKeys(env())!;
    const sealed = keys.encrypt('User.phone', '+6281234567890');

    expect(() => keys.decrypt('User.phone', { ...sealed, keyId: 'enc-retired' })).toThrow(
      /enc-retired/,
    );
  });
});
