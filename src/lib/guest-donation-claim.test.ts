import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { randomBytes } from 'node:crypto';

/**
 * A Guest Donor who later registers finds their past gifts waiting, and nobody
 * can claim anyone else's (prd-compliance 23; CONTEXT.md, Guest Donor; ADR
 * 0012). What is protected here: the match is the stored HMAC against the
 * stored HMAC (no address is decrypted), only an account whose address was
 * confirmed by link may claim, and a Donation whose HMAC was cleared
 * (anonymised, PR #172) cannot match, by HMAC and by `anonymisedAt` both.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    donation: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

import { claimGuestDonations } from './guest-donation-claim';
import { prisma } from '@/lib/prisma';
import { lookupDonationGuestEmail, sealDonationGuestEmail, sealUserEmail } from './contact-fields';

const findUser = prisma.user.findUnique as unknown as Mock;
const findDonations = prisma.donation.findMany as unknown as Mock;
const updateDonations = prisma.donation.updateMany as unknown as Mock;

const account = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  ...sealUserEmail('sari@test.com'),
  emailVerifiedAt: new Date('2026-10-02T00:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  updateDonations.mockResolvedValue({ count: 0 });
});

describe('claimGuestDonations', () => {
  it('an unverified account claims nothing, however the email matches', async () => {
    findUser.mockResolvedValue(account({ emailVerifiedAt: null }));

    const result = await claimGuestDonations('user-1');

    expect(result).toEqual({ verified: false, claimed: 0 });
    expect(findDonations).not.toHaveBeenCalled();
    expect(updateDonations).not.toHaveBeenCalled();
  });

  it('claims nothing for an account that does not exist', async () => {
    findUser.mockResolvedValue(null);

    expect(await claimGuestDonations('ghost')).toEqual({ verified: false, claimed: 0 });
    expect(updateDonations).not.toHaveBeenCalled();
  });

  it('matches guest Donations through the stored HMAC and key id, never a decrypted scan', async () => {
    findUser.mockResolvedValue(account());
    findDonations.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);
    updateDonations.mockResolvedValue({ count: 2 });

    const result = await claimGuestDonations('user-1');

    expect(findDonations).toHaveBeenCalledWith({
      where: { donorId: null, anonymisedAt: null, ...lookupDonationGuestEmail('sari@test.com') },
      // Ids only: no guest name, message or ciphertext is read for the claim.
      select: { id: true },
    });
    expect(updateDonations).toHaveBeenCalledWith({
      // Same four conditions as the read: a row linked, anonymised or re-keyed
      // in between no longer matches.
      where: {
        id: { in: ['d1', 'd2'] },
        donorId: null,
        anonymisedAt: null,
        ...lookupDonationGuestEmail('sari@test.com'),
      },
      data: { donorId: 'user-1' },
    });
    expect(result).toEqual({ verified: true, claimed: 2 });
  });

  it('an account with no readable email matches nothing', async () => {
    findUser.mockResolvedValue(account({ emailCiphertext: null }));

    expect(await claimGuestDonations('user-1')).toEqual({ verified: true, claimed: 0 });
    expect(findDonations).not.toHaveBeenCalled();
    expect(updateDonations).not.toHaveBeenCalled();
  });

  it('writes nothing when there is nothing to claim', async () => {
    findUser.mockResolvedValue(account());
    findDonations.mockResolvedValue([]);

    expect(await claimGuestDonations('user-1')).toEqual({ verified: true, claimed: 0 });
    expect(updateDonations).not.toHaveBeenCalled();
  });

  describe('across a key rotation', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    function rotate() {
      process.env.FIELD_ENCRYPTION_PREVIOUS_KEYS = `${process.env.FIELD_ENCRYPTION_KEY_ID}:${process.env.FIELD_ENCRYPTION_KEY}`;
      process.env.FIELD_HMAC_PREVIOUS_KEYS = `${process.env.FIELD_HMAC_KEY_ID}:${process.env.FIELD_HMAC_KEY}`;
      process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
      process.env.FIELD_ENCRYPTION_KEY_ID = 'enc-test-2';
      process.env.FIELD_HMAC_KEY = randomBytes(32).toString('base64');
      process.env.FIELD_HMAC_KEY_ID = 'hmac-test-2';
    }

    /** A donations table in memory that applies an `OR` of hmac + key id pairs as Prisma does. */
    function donationsTable(rows: Array<Record<string, unknown>>) {
      const matches = (row: Record<string, unknown>, where: { id?: { in: unknown[] }; donorId: unknown; anonymisedAt: unknown; OR: Array<Record<string, unknown>> }): boolean =>
        (where.id === undefined || where.id.in.includes(row.id)) &&
        row.donorId === where.donorId &&
        row.anonymisedAt === where.anonymisedAt &&
        where.OR.some(
          (pair) => row.guestEmailHmac === pair.guestEmailHmac && row.guestEmailHmacKeyId === pair.guestEmailHmacKeyId,
        );
      findDonations.mockImplementation(async ({ where }) => rows.filter((r) => matches(r, where)).map(({ id }) => ({ id })));
      updateDonations.mockImplementation(async ({ where, data }) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      });
      return rows;
    }

    const guest = (id: string) => {
      const sealed = sealDonationGuestEmail('sari@test.com');
      return { id, donorId: null, anonymisedAt: null, guestEmailHmac: sealed.guestEmailHmac, guestEmailHmacKeyId: sealed.guestEmailHmacKeyId };
    };

    it('an account hashed under the old key claims a guest Donation hashed under the new key', async () => {
      findUser.mockResolvedValue(account());
      rotate();
      const rows = donationsTable([guest('new-key-donation')]);

      expect(await claimGuestDonations('user-1')).toEqual({ verified: true, claimed: 1 });
      expect(rows[0].donorId).toBe('user-1');
    });

    it('an account hashed under the new key claims a guest Donation hashed under the old key', async () => {
      const old = guest('old-key-donation');
      rotate();
      findUser.mockResolvedValue(account());
      const rows = donationsTable([old]);

      expect(await claimGuestDonations('user-1')).toEqual({ verified: true, claimed: 1 });
      expect(rows[0].donorId).toBe('user-1');
    });

    it('still claims nothing of another address, nor of an anonymised Donation', async () => {
      rotate();
      findUser.mockResolvedValue(account());
      const other = { ...guest('other'), guestEmailHmac: 'not-sari' };
      const anonymised = { ...guest('gone'), anonymisedAt: new Date() };
      donationsTable([other, anonymised]);

      expect(await claimGuestDonations('user-1')).toEqual({ verified: true, claimed: 0 });
    });
  });
});
