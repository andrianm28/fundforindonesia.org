import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * A Guest Donor who later registers finds their past gifts waiting, and nobody
 * can claim anyone else's (prd-compliance 23; CONTEXT.md, Guest Donor; ADR
 * 0012). What is protected here: the match is the stored HMAC against the
 * stored HMAC (no address is decrypted), only an account whose address was
 * confirmed by link may claim, and a Donation whose HMAC was cleared
 * (anonymised, PR #172) cannot match.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    donation: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

import { claimGuestDonations } from './guest-donation-claim';
import { prisma } from '@/lib/prisma';

const findUser = prisma.user.findUnique as unknown as Mock;
const findDonations = prisma.donation.findMany as unknown as Mock;
const updateDonations = prisma.donation.updateMany as unknown as Mock;

const account = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  emailHmac: 'hmac-of-sari',
  emailHmacKeyId: 'k1',
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
      where: { donorId: null, guestEmailHmac: 'hmac-of-sari', guestEmailHmacKeyId: 'k1' },
      // Ids only: no guest name, message or ciphertext is read for the claim.
      select: { id: true },
    });
    expect(updateDonations).toHaveBeenCalledWith({
      // Same three conditions as the read: a row linked, anonymised or re-keyed
      // in between no longer matches.
      where: {
        id: { in: ['d1', 'd2'] },
        donorId: null,
        guestEmailHmac: 'hmac-of-sari',
        guestEmailHmacKeyId: 'k1',
      },
      data: { donorId: 'user-1' },
    });
    expect(result).toEqual({ verified: true, claimed: 2 });
  });

  it('an account with an empty HMAC matches nothing, so a cleared Donation HMAC is never a match', async () => {
    findUser.mockResolvedValue(account({ emailHmac: '' }));

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
});
