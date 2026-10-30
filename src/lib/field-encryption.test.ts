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

describe('rotation: retired keys kept for reading', () => {
  const oldEnc = randomBytes(32).toString('base64');
  const oldHmac = randomBytes(32).toString('base64');
  const rotated = (overrides: Record<string, string | undefined> = {}) =>
    env({
      FIELD_ENCRYPTION_PREVIOUS_KEYS: `enc-old:${oldEnc}`,
      FIELD_HMAC_PREVIOUS_KEYS: `hmac-old:${oldHmac}`,
      ...overrides,
    });

  // The env of the deployment before the rotation: what the old key sealed.
  const before = () =>
    loadFieldKeys({
      FIELD_ENCRYPTION_KEY: oldEnc,
      FIELD_ENCRYPTION_KEY_ID: 'enc-old',
      FIELD_HMAC_KEY: oldHmac,
      FIELD_HMAC_KEY_ID: 'hmac-old',
    })!;

  it('decrypts a value sealed under a retired key, and encrypts under the current one', () => {
    const old = before().encrypt('User.phone', '+6281234567890');
    const keys = loadFieldKeys(rotated())!;

    expect(old.keyId).toBe('enc-old');
    expect(keys.decrypt('User.phone', old)).toBe('+6281234567890');
    expect(keys.encrypt('User.phone', 'x').keyId).toBe('enc-test-1');
  });

  it('still refuses a key id that is neither current nor retired', () => {
    const keys = loadFieldKeys(rotated())!;
    const sealed = keys.encrypt('User.phone', 'x');

    expect(() => keys.decrypt('User.phone', { ...sealed, keyId: 'enc-unknown' })).toThrow(/enc-unknown/);
  });

  it('offers a lookup per HMAC key, the current one first, and writes only the current one', () => {
    const keys = loadFieldKeys(rotated())!;
    const lookups = keys.emailLookups('Andi@Email.com');

    expect(lookups).toHaveLength(2);
    expect(lookups[0]).toEqual(keys.emailLookup('andi@email.com'));
    expect(lookups[0].keyId).toBe('hmac-test-1');
    expect(lookups[1]).toEqual(before().emailLookup('andi@email.com'));
  });

  it('has exactly one lookup when nothing is retired', () => {
    const keys = loadFieldKeys(env())!;

    expect(keys.emailLookups('a@b.co')).toEqual([keys.emailLookup('a@b.co')]);
  });

  it('accepts several retired keys, spaces and a trailing comma', () => {
    const k2 = randomBytes(32).toString('base64');
    const keys = loadFieldKeys(
      env({ FIELD_ENCRYPTION_PREVIOUS_KEYS: ` enc-old:${oldEnc} , enc-older:${k2}, ` }),
    )!;
    const sealed = loadFieldKeys({
      FIELD_ENCRYPTION_KEY: k2,
      FIELD_ENCRYPTION_KEY_ID: 'enc-older',
      FIELD_HMAC_KEY: oldHmac,
      FIELD_HMAC_KEY_ID: 'h',
    })!.encrypt('User.phone', 'p');

    expect(keys.decrypt('User.phone', sealed)).toBe('p');
  });

  it('refuses a retired key that is not 32 bytes, naming the variable and not the value', () => {
    const short = randomBytes(16).toString('base64');
    let message = '';
    try {
      loadFieldKeys(env({ FIELD_HMAC_PREVIOUS_KEYS: `hmac-old:${short}` }));
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toMatch(/FIELD_HMAC_PREVIOUS_KEYS.*32 bytes/);
    expect(message).not.toContain(short);
  });

  it('refuses a malformed entry without echoing it', () => {
    const bad = 'no-colon-here-secretvalue';
    let message = '';
    try {
      loadFieldKeys(env({ FIELD_ENCRYPTION_PREVIOUS_KEYS: bad }));
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toMatch(/FIELD_ENCRYPTION_PREVIOUS_KEYS.*id:base64key/);
    expect(message).not.toContain(bad);
  });

  it('refuses ids that repeat, within a list or against the current id', () => {
    expect(() => loadFieldKeys(rotated({ FIELD_ENCRYPTION_PREVIOUS_KEYS: `enc-test-1:${oldEnc}` }))).toThrow(
      /FIELD_ENCRYPTION_PREVIOUS_KEYS.*unique/,
    );
    const k2 = randomBytes(32).toString('base64');
    expect(() =>
      loadFieldKeys(rotated({ FIELD_HMAC_PREVIOUS_KEYS: `h:${oldHmac},h:${k2}` })),
    ).toThrow(/FIELD_HMAC_PREVIOUS_KEYS.*unique/);
  });

  it('refuses an encryption id that equals an HMAC id, in either direction', () => {
    expect(() => loadFieldKeys(rotated({ FIELD_ENCRYPTION_PREVIOUS_KEYS: `hmac-old:${oldEnc}` }))).toThrow(
      /must differ/,
    );
    expect(() => loadFieldKeys(rotated({ FIELD_HMAC_PREVIOUS_KEYS: `enc-test-1:${oldHmac}` }))).toThrow(
      /must differ/,
    );
  });

  it('refuses a retired key that is also used for the other job', () => {
    expect(() => loadFieldKeys(rotated({ FIELD_HMAC_PREVIOUS_KEYS: `hmac-old:${oldEnc}` }))).toThrow(/separate/);
  });

  it('refuses retired keys with no current keys', () => {
    expect(() =>
      loadFieldKeys({ FIELD_ENCRYPTION_PREVIOUS_KEYS: `enc-old:${oldEnc}` }),
    ).toThrow(/FIELD_ENCRYPTION_PREVIOUS_KEYS/);
  });
});
