// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadFieldKeys, type FieldKeys } from './field-encryption';
import { contactFieldWrites } from './field-protection';

const keys = loadFieldKeys({
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  FIELD_ENCRYPTION_KEY_ID: 'enc-test-1',
  FIELD_HMAC_KEY: randomBytes(32).toString('base64'),
  FIELD_HMAC_KEY_ID: 'hmac-test-1',
}) as FieldKeys;

/** Runs one hooked operation and returns the args it forwarded to Prisma. */
async function forwarded(
  model: 'user' | 'bankAccount' | 'donation',
  operation: string,
  args: Record<string, unknown>,
  withKeys: FieldKeys | null = keys,
) {
  const query = vi.fn(async (a: unknown) => a);
  const hooks = contactFieldWrites(withKeys) as unknown as Record<
    string,
    Record<string, (p: { args: unknown; query: typeof query }) => Promise<unknown>>
  >;
  await hooks[model][operation]({ args, query });
  expect(query).toHaveBeenCalledTimes(1);
  return query.mock.calls[0][0] as Record<string, Record<string, unknown>>;
}

describe('User writes keep the plaintext and add the protected forms', () => {
  it('registering a Donor stores the email plaintext, its lookup HMAC and its ciphertext', async () => {
    const { data } = await forwarded('user', 'create', {
      data: { name: 'Andi Wijaya', email: 'Andi@Email.com', password: 'hash' },
    });

    expect(data.email).toBe('Andi@Email.com');
    expect(data).toMatchObject({
      emailHmac: keys.emailLookup('andi@email.com').hmac,
      emailHmacKeyId: 'hmac-test-1',
      emailKeyId: 'enc-test-1',
    });
    expect(
      keys.decrypt('User.email', {
        ciphertext: data.emailCiphertext as string,
        keyId: data.emailKeyId as string,
      }),
    ).toBe('Andi@Email.com');
  });

  it('leaves the name plaintext and adds nothing for it: ADR 0012 keeps it readable', async () => {
    const { data } = await forwarded('user', 'create', {
      data: { name: 'Andi Wijaya', email: 'andi@email.com' },
    });

    expect(data.name).toBe('Andi Wijaya');
    expect(Object.keys(data).filter((k) => k.startsWith('name'))).toEqual(['name']);
  });

  it('encrypts a phone number, and clears its ciphertext when the phone is cleared', async () => {
    const set = await forwarded('user', 'update', {
      where: { id: 'u1' },
      data: { phone: '+6281234567890' },
    });
    expect(set.data.phone).toBe('+6281234567890');
    expect(set.data.phoneKeyId).toBe('enc-test-1');
    expect(
      keys.decrypt('User.phone', {
        ciphertext: set.data.phoneCiphertext as string,
        keyId: 'enc-test-1',
      }),
    ).toBe('+6281234567890');

    const cleared = await forwarded('user', 'update', { where: { id: 'u1' }, data: { phone: null } });
    expect(cleared.data).toEqual({ phone: null, phoneCiphertext: null, phoneKeyId: null });
  });

  it('leaves an update that touches no contact field exactly as it was', async () => {
    const args = { where: { id: 'u1' }, data: { name: 'Andi' }, select: { id: true } };

    expect(await forwarded('user', 'update', structuredClone(args))).toEqual(args);
  });

  it('protects both branches of an upsert, and every row of a createMany', async () => {
    const upsert = await forwarded('user', 'upsert', {
      where: { email: 'a@x.id' },
      create: { name: 'A', email: 'a@x.id' },
      update: { email: 'b@x.id' },
    });
    expect(upsert.create.emailHmac).toBe(keys.emailLookup('a@x.id').hmac);
    expect(upsert.update.emailHmac).toBe(keys.emailLookup('b@x.id').hmac);
    expect(upsert.where).toEqual({ email: 'a@x.id' });

    const many = await forwarded('user', 'createMany', {
      data: [
        { name: 'A', email: 'a@x.id' },
        { name: 'B', email: 'b@x.id', phone: '0812' },
      ],
    });
    const rows = many.data as unknown as Record<string, unknown>[];
    expect(rows.map((r) => r.emailHmac)).toEqual([
      keys.emailLookup('a@x.id').hmac,
      keys.emailLookup('b@x.id').hmac,
    ]);
    expect(rows[1].phoneKeyId).toBe('enc-test-1');

    for (const operation of ['createManyAndReturn', 'updateMany', 'updateManyAndReturn']) {
      const { data } = await forwarded('user', operation, { data: { phone: '0812' } });
      expect(data.phoneKeyId, operation).toBe('enc-test-1');
    }
  });

  it('understands the { set } form of an update', async () => {
    const { data } = await forwarded('user', 'update', {
      where: { id: 'u1' },
      data: { email: { set: 'c@x.id' } },
    });

    expect(data.emailHmac).toBe(keys.emailLookup('c@x.id').hmac);
  });
});

describe('BankAccount writes', () => {
  it('keep the account number plaintext and add its ciphertext', async () => {
    const { data } = await forwarded('bankAccount', 'create', {
      data: { ownerId: 'u1', bankCode: 'BCA', accountNumber: '1234567890', accountName: 'Andi' },
    });

    expect(data.accountNumber).toBe('1234567890');
    expect(data.accountName).toBe('Andi');
    expect(data.accountNumberKeyId).toBe('enc-test-1');
    expect(
      keys.decrypt('BankAccount.accountNumber', {
        ciphertext: data.accountNumberCiphertext as string,
        keyId: 'enc-test-1',
      }),
    ).toBe('1234567890');
  });
});

describe('Donation writes (Guest Donor contact details, prd-compliance 18)', () => {
  it('stores a Guest Donor email plaintext, its lookup HMAC and its ciphertext', async () => {
    const { data } = await forwarded('donation', 'create', {
      data: {
        amount: 50000,
        campaignId: 'c1',
        paymentMethod: 'qris',
        guestEmail: 'Guest@Email.com',
        guestName: 'Tamu Baik',
      },
    });

    expect(data.guestEmail).toBe('Guest@Email.com');
    expect(data.guestName).toBe('Tamu Baik');
    expect(data).toMatchObject({
      guestEmailHmac: keys.emailLookup('guest@email.com').hmac,
      guestEmailHmacKeyId: 'hmac-test-1',
      guestEmailKeyId: 'enc-test-1',
    });
    expect(
      keys.decrypt('Donation.guestEmail', {
        ciphertext: data.guestEmailCiphertext as string,
        keyId: data.guestEmailKeyId as string,
      }),
    ).toBe('Guest@Email.com');
  });

  it('leaves guestName plaintext and adds nothing for it', async () => {
    const { data } = await forwarded('donation', 'create', {
      data: { amount: 50000, campaignId: 'c1', paymentMethod: 'qris', guestName: 'Tamu Baik' },
    });

    expect(data.guestName).toBe('Tamu Baik');
    expect(Object.keys(data).filter((k) => k.startsWith('guestName'))).toEqual(['guestName']);
  });

  it('encrypts a Guest Donor phone number, and leaves it absent when none is given', async () => {
    const { data } = await forwarded('donation', 'create', {
      data: { amount: 50000, campaignId: 'c1', paymentMethod: 'qris', guestPhone: '081200000000' },
    });

    expect(data.guestPhone).toBe('081200000000');
    expect(
      keys.decrypt('Donation.guestPhone', {
        ciphertext: data.guestPhoneCiphertext as string,
        keyId: data.guestPhoneKeyId as string,
      }),
    ).toBe('081200000000');

    const { data: withoutPhone } = await forwarded('donation', 'create', {
      data: { amount: 50000, campaignId: 'c1', paymentMethod: 'qris' },
    });
    expect(withoutPhone.guestPhoneCiphertext).toBeUndefined();
  });

  it('leaves a registered Donor donation (no guest fields) untouched', async () => {
    const args = { data: { amount: 50000, campaignId: 'c1', paymentMethod: 'qris', donorId: 'u1' } };
    expect(await forwarded('donation', 'create', structuredClone(args))).toEqual(args);
  });
});

describe('without keys', () => {
  it('writes exactly what it was given, so a deployment without keys behaves as before', async () => {
    const args = { data: { name: 'A', email: 'a@x.id', phone: '0812' } };

    expect(await forwarded('user', 'create', structuredClone(args), null)).toEqual(args);
  });
});
