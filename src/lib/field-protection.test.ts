// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { contactFieldWrites } from './field-protection';
import { readBankAccountNumber, readDonationGuestEmail, readUserEmail, sealUserEmail } from './contact-fields';

/**
 * The client hook, now that the plaintext columns are gone (prd-compliance 16,
 * the contract step). The expand step added the protected forms beside the
 * plaintext and let both through; this one seals the plaintext a caller hands
 * it and does not let it reach the database, so a route, the seed or the
 * Auth.js adapter cannot store a contact detail in the clear even by accident.
 *
 * The hook is the last line of that guard rather than the only one: application
 * code seals at the call site with src/lib/contact-fields.ts, and the hook
 * catches whatever is left. Both must produce the same protected columns, so
 * the columns are compared rather than each side's idea of them restated.
 */

async function forwarded(
  model: 'user' | 'bankAccount' | 'donation' | 'partnershipInquiry',
  operation: string,
  args: Record<string, unknown>,
) {
  const query = vi.fn(async (a: unknown) => a);
  const hooks = contactFieldWrites() as unknown as Record<
    string,
    Record<string, (p: { args: unknown; query: typeof query }) => Promise<unknown>>
  >;
  await hooks[model][operation]({ args, query });
  return query.mock.calls[0][0] as Record<string, Record<string, unknown>>;
}

describe('a write of a contact detail reaches Prisma as protected columns only', () => {
  it('stores a Donor account email as its HMAC and its ciphertext, never as plaintext', async () => {
    const { data } = await forwarded('user', 'create', {
      data: { name: 'Andi Wijaya', email: 'Andi@Email.com', password: 'hash' },
    });

    expect(data).not.toHaveProperty('email');
    expect(Object.keys(data).filter((name) => /^(email|phone)/.test(name)).sort()).toEqual([
      'emailCiphertext',
      'emailHmac',
      'emailHmacKeyId',
      'emailKeyId',
    ]);
  });

  it('agrees with the call-site seal on every protected column it writes', async () => {
    const { data } = await forwarded('user', 'create', {
      data: { name: 'Andi', email: 'Andi@Email.com', phone: '0812' },
    });
    const sealed = sealUserEmail('Andi@Email.com');

    expect(data.emailHmac).toBe(sealed.emailHmac);
    expect(data.emailHmacKeyId).toBe(sealed.emailHmacKeyId);
    expect(data.emailKeyId).toBe(sealed.emailKeyId);
    // Read through the same function a reader uses, which is the point: what
    // the hook wrote is what a reader gets back.
    expect(readUserEmail(data as { emailCiphertext: string; emailKeyId: string })).toBe('Andi@Email.com');
  });

  it('protects a Bank Account number, a Guest Donor contact and a company contact the same way', async () => {
    const account = await forwarded('bankAccount', 'create', {
      data: { ownerId: 'u1', bankCode: 'BCA', accountNumber: '1234567890', accountName: 'Andi' },
    });
    const donation = await forwarded('donation', 'create', {
      data: { amount: 50000, campaignId: 'c1', paymentMethod: 'qris', guestEmail: 'a@x.id', guestPhone: '0812' },
    });
    const inquiry = await forwarded('partnershipInquiry', 'create', {
      data: { programId: 'p1', companyName: 'PT Sinar', contactEmail: 'a@x.id', contactPhone: '0812' },
    });

    expect(account.data).not.toHaveProperty('accountNumber');
    expect(donation.data).not.toHaveProperty('guestEmail');
    expect(inquiry.data).not.toHaveProperty('contactEmail');
    expect(readBankAccountNumber(account.data as { accountNumberCiphertext: string; accountNumberKeyId: string })).toBe('1234567890');
    expect(
      readDonationGuestEmail(donation.data as { guestEmailCiphertext: string; guestEmailKeyId: string }),
    ).toBe('a@x.id');
  });

  it('leaves a write that touches no contact detail exactly as it was', async () => {
    const args = { where: { id: 'u1' }, data: { name: 'Andi' }, select: { id: true } };

    expect(await forwarded('user', 'update', structuredClone(args))).toEqual(args);
  });

  it('leaves the names plaintext, because ADR 0012 keeps them readable', async () => {
    const { data } = await forwarded('bankAccount', 'create', {
      data: { ownerId: 'u1', bankCode: 'BCA', accountNumber: '1234567890', accountName: 'Andi' },
    });

    expect(data.accountName).toBe('Andi');
    expect(Object.keys(data).filter((name) => name.startsWith('accountName'))).toEqual(['accountName']);
  });

  it('clears the protected columns when the contact detail is cleared', async () => {
    const { data } = await forwarded('user', 'update', { where: { id: 'u1' }, data: { phone: null } });

    expect(data).toEqual({ phoneCiphertext: null, phoneKeyId: null });
  });

  it('understands the { set } form of an update', async () => {
    const { data } = await forwarded('user', 'update', {
      where: { id: 'u1' },
      data: { email: { set: 'c@x.id' } },
    });

    expect(data).not.toHaveProperty('email');
    expect(Object.keys(data).filter((name) => name.startsWith('email'))).toHaveLength(4);
  });

  it('protects every row of a createMany', async () => {
    const { data } = await forwarded('user', 'createMany', {
      data: [
        { name: 'A', email: 'a@x.id' },
        { name: 'B' },
      ],
    });
    const rows = data as unknown as Record<string, unknown>[];

    expect(rows[0]).not.toHaveProperty('email');
    expect(rows[0].emailHmac).toBeDefined();
    expect(rows[1]).toEqual({ name: 'B' });
  });

  it('protects both branches of an upsert, and leaves its where alone', async () => {
    const { create, update, where } = await forwarded('user', 'upsert', {
      where: { emailHmac: 'x' },
      create: { name: 'A', email: 'a@x.id' },
      update: { email: 'b@x.id' },
    });

    expect(create).not.toHaveProperty('email');
    expect(update).not.toHaveProperty('email');
    expect(where).toEqual({ emailHmac: 'x' });
  });
});

describe('without keys', () => {
  it('refuses the write rather than storing a contact detail in the clear', async () => {
    const hooks = contactFieldWrites(null) as unknown as Record<
      string,
      Record<string, (p: { args: unknown; query: unknown }) => Promise<unknown>>
    >;

    expect(() =>
      hooks.user.create({ args: { data: { name: 'A', email: 'a@x.id' } }, query: async () => ({}) }),
    ).toThrow(/FIELD_ENCRYPTION_KEY/);
  });
});
