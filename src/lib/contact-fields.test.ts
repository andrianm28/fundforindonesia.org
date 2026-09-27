// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { loadFieldKeys } from './field-encryption';
import {
  SELECT_USER_EMAIL,
  lookupInquiryContactEmail,
  lookupUserEmail,
  readBankAccountNumber,
  readDonationGuestEmail,
  readDonationGuestPhone,
  readInquiryContactEmail,
  readUserEmail,
  readUserPhone,
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
 * The contact details ADR 0012 protects, through the one seam every writer and
 * every reader uses now that the plaintext columns are gone (prd-compliance 16).
 *
 * The keys come from the environment, the way the running app has them, so this
 * reads the same values the app would. tests/setup.ts sets them.
 */
const keys = requireFieldKeys();


describe('sealing a contact detail for a write', () => {
  it('stores an email as its lookup HMAC and its ciphertext, and no plaintext', () => {
    const sealed = sealUserEmail('Andi@Email.com');

    expect(Object.keys(sealed).sort()).toEqual([
      'emailCiphertext',
      'emailHmac',
      'emailHmacKeyId',
      'emailKeyId',
    ]);
    expect(sealed.emailHmac).toBe(keys.emailLookup('andi@email.com').hmac);
    expect(keys.decrypt('User.email', { ciphertext: sealed.emailCiphertext, keyId: sealed.emailKeyId })).toBe(
      'Andi@Email.com',
    );
  });

  it('gives the same value the same lookup and a different ciphertext every time', () => {
    const first = sealUserEmail('andi@email.com');
    const second = sealUserEmail('andi@email.com');

    expect(second.emailHmac).toBe(first.emailHmac);
    expect(second.emailCiphertext).not.toBe(first.emailCiphertext);
  });

  it('matches an email however the Donor typed it, because the lookup normalizes', () => {
    expect(sealUserEmail('  ANDI@Email.com ').emailHmac).toBe(sealUserEmail('andi@email.com').emailHmac);
  });

  it('encrypts a phone number and no other way: it is never searched, so it has no HMAC', () => {
    const sealed = sealUserPhone('+6281234567890');

    expect(Object.keys(sealed).sort()).toEqual(['phoneCiphertext', 'phoneKeyId']);
    expect(
      keys.decrypt('User.phone', { ciphertext: sealed.phoneCiphertext as string, keyId: sealed.phoneKeyId as string }),
    ).toBe('+6281234567890');
  });

  it('clears a phone number that was cleared, rather than sealing the string "null"', () => {
    expect(sealUserPhone(null)).toEqual({ phoneCiphertext: null, phoneKeyId: null });
  });

  // Not a restatement of what the code returns: it is a list of the seven
  // protected details, each sealed, and the assertion is that none of them
  // carries a column named after the bare value it protects. That is the
  // property the whole contract step rests on.
  it('protects every field the expand step did, on all four models, and names none of them plainly', () => {
    const sealed: Record<string, unknown>[] = [
      sealUserEmail('a@x.id'),
      sealUserPhone('0812'),
      sealBankAccountNumber('1234567890'),
      sealDonationGuestEmail('a@x.id'),
      sealDonationGuestPhone('0812'),
      sealInquiryContactEmail('a@x.id'),
      sealInquiryContactPhone('0812'),
    ];

    for (const columns of sealed) {
      expect(Object.keys(columns).some((name) => /^[a-z]+$/.test(name)), JSON.stringify(columns)).toBe(false);
    }
    expect(sealDonationGuestEmail('a@x.id').guestEmailHmac).toBe(sealUserEmail('a@x.id').emailHmac);
    expect(sealInquiryContactEmail('A@X.ID').contactEmailHmac).toBe(sealUserEmail('a@x.id').emailHmac);
  });
});

describe('reading a contact detail back', () => {
  it('decrypts each of them under the name it was sealed with', () => {
    const user = sealUserEmail('andi@email.com');
    const phone = sealUserPhone('0812');
    const account = sealBankAccountNumber('1234567890');
    const guest = sealDonationGuestEmail('guest@email.com');
    const guestPhone = sealDonationGuestPhone('0812');
    const inquiry = sealInquiryContactEmail('budi@sponsor.com');

    expect(readUserEmail(user)).toBe('andi@email.com');
    expect(readUserPhone(phone)).toBe('0812');
    expect(readBankAccountNumber(account)).toBe('1234567890');
    expect(readDonationGuestEmail(guest)).toBe('guest@email.com');
    expect(readDonationGuestPhone(guestPhone)).toBe('0812');
    expect(readInquiryContactEmail(inquiry)).toBe('budi@sponsor.com');
  });

  // The additional authenticated data binds a ciphertext to the column it was
  // sealed for, so the table below cannot move a name without invalidating
  // every row already written under the old one. These are the names ADR 0012
  // was implemented with, written out rather than recomputed.
  it('reads what the expand step sealed, under the name it sealed it with', () => {
    const expandStepRow = {
      emailCiphertext: keys.encrypt('User.email', 'andi@email.com').ciphertext,
      emailKeyId: keys.encrypt('User.email', 'andi@email.com').keyId,
      phoneCiphertext: keys.encrypt('User.phone', '0812').ciphertext,
      phoneKeyId: keys.encrypt('User.phone', '0812').keyId,
    };

    expect(readUserEmail(expandStepRow)).toBe('andi@email.com');
    expect(readUserPhone(expandStepRow)).toBe('0812');
  });

  it('is null for a detail nobody gave, and for a row the backfill has not reached', () => {
    expect(readUserPhone({ phoneCiphertext: null, phoneKeyId: null })).toBeNull();
    expect(readDonationGuestEmail({ guestEmailCiphertext: null, guestEmailKeyId: null })).toBeNull();
  });

  it('refuses rather than returning nothing when the key is not the one that sealed it', () => {
    expect(() =>
      readUserEmail({ emailCiphertext: sealUserEmail('andi@email.com').emailCiphertext, emailKeyId: 'enc-other' }),
    ).toThrow(/enc-other/);
  });
});

describe('looking a contact detail up', () => {
  it('filters on the HMAC and its key id, so no row is ever decrypted to be compared', () => {
    expect(lookupUserEmail('Andi@Email.com')).toEqual({
      emailHmac: keys.emailLookup('andi@email.com').hmac,
      emailHmacKeyId: keys.emailLookup('andi@email.com').keyId,
    });
  });

  it('finds the same Donor whichever address they type', () => {
    expect(lookupUserEmail('ANDI@EMAIL.COM').emailHmac).toBe(lookupUserEmail('andi@email.com').emailHmac);
    expect(lookupInquiryContactEmail('budi@sponsor.com').contactEmailHmac).toBe(
      keys.emailLookup('budi@sponsor.com').hmac,
    );
  });

  it('asks for exactly the two columns a reader needs and nothing else', () => {
    expect(SELECT_USER_EMAIL).toEqual({ emailCiphertext: true, emailKeyId: true });
    expect(Object.keys(SELECT_USER_EMAIL)).not.toContain('emailHmac');
  });
});

describe('the keys themselves', () => {
  it('are required: a deployment without them has no plaintext to fall back on', () => {
    const saved = { ...process.env };
    delete process.env.FIELD_ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY_ID;
    delete process.env.FIELD_HMAC_KEY;
    delete process.env.FIELD_HMAC_KEY_ID;
    try {
      expect(() => requireFieldKeys()).toThrow(/FIELD_ENCRYPTION_KEY/);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it('are half-configured never accepted, because half a scheme loses a value', () => {
    expect(() => loadFieldKeys({ FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') })).toThrow(
      /half-configured/,
    );
  });
});
