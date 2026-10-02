import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * An account proves it owns its address by opening a link sent to it
 * (prd-compliance 23). The link is the only proof: the request is for the
 * signed-in account's OWN address (so it cannot be pointed at someone else's
 * inbox or used to ask whether an address has history), the token is stored
 * hashed, one-use and short-lived, and it confirms the address it was issued
 * for and no later one.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    emailVerificationToken: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('@/lib/mail', () => ({ sendReportingFailure: vi.fn() }));
vi.mock('@/lib/guest-donation-claim', () => ({ claimGuestDonations: vi.fn() }));

import { confirmEmailVerification, requestEmailVerification } from './email-verification';
import { sealUserEmail } from './contact-fields';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';
import { claimGuestDonations } from '@/lib/guest-donation-claim';

const findUser = prisma.user.findUnique as unknown as Mock;
const updateUser = prisma.user.update as unknown as Mock;
const tokens = prisma.emailVerificationToken as unknown as Record<'findFirst' | 'findUnique' | 'create' | 'delete' | 'updateMany', Mock>;
const send = sendReportingFailure as unknown as Mock;
const claim = claimGuestDonations as unknown as Mock;

const NOW = new Date('2026-10-02T10:00:00Z');

function account(overrides: Record<string, unknown> = {}) {
  return { id: 'user-1', name: 'Sari', emailVerifiedAt: null, ...sealUserEmail('sari@example.test'), ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  send.mockResolvedValue(true);
  tokens.findFirst.mockResolvedValue(null);
  tokens.create.mockResolvedValue({ id: 'tok-row' });
  claim.mockResolvedValue({ claimed: 0 });
});

describe('requestEmailVerification', () => {
  it('emails the account its own address a link whose token is stored only as a hash', async () => {
    findUser.mockResolvedValue(account());

    const result = await requestEmailVerification('user-1', NOW);

    expect(result).toEqual({ status: 'sent' });
    const message = send.mock.calls[0][0] as { to: string; text: string };
    expect(message.to).toBe('sari@example.test');
    const token = /token=([\w-]+)/.exec(message.text)![1];
    const stored = tokens.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.userId).toBe('user-1');
    expect(stored.emailHmac).toBe(account().emailHmac);
    expect(stored.expiresAt).toEqual(new Date('2026-10-03T10:00:00Z'));
  });

  it('sends nothing to an account that is already verified', async () => {
    findUser.mockResolvedValue(account({ emailVerifiedAt: NOW }));

    expect(await requestEmailVerification('user-1', NOW)).toEqual({ status: 'already-verified' });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a second link inside the cooldown, so the inbox cannot be hammered', async () => {
    findUser.mockResolvedValue(account());
    tokens.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-02T09:59:30Z') });

    expect(await requestEmailVerification('user-1', NOW)).toEqual({ status: 'too-soon' });
    expect(send).not.toHaveBeenCalled();
    expect(tokens.create).not.toHaveBeenCalled();
  });

  it('does not burn the cooldown when the mail is not delivered', async () => {
    findUser.mockResolvedValue(account());
    send.mockResolvedValue(false);

    expect(await requestEmailVerification('user-1', NOW)).toEqual({ status: 'send-failed' });
    expect(tokens.delete).toHaveBeenCalledWith({ where: { id: 'tok-row' } });
  });
});

describe('confirmEmailVerification', () => {
  const rawToken = 'raw-token-value';
  const hash = createHash('sha256').update(rawToken).digest('hex');
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'tok-row',
    userId: 'user-1',
    emailHmac: account().emailHmac,
    expiresAt: new Date('2026-10-03T10:00:00Z'),
    usedAt: null,
    ...overrides,
  });

  it('marks the address verified, spends the token, and claims the guest history', async () => {
    tokens.findUnique.mockResolvedValue(row());
    findUser.mockResolvedValue(account());
    tokens.updateMany.mockResolvedValue({ count: 1 });
    claim.mockResolvedValue({ claimed: 3 });

    const result = await confirmEmailVerification(rawToken, NOW);

    expect(tokens.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hash } });
    expect(tokens.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok-row', usedAt: null },
      data: { usedAt: NOW },
    });
    expect(updateUser).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { emailVerifiedAt: NOW } });
    expect(claim).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ ok: true, claimed: 3 });
  });

  it.each([
    ['unknown', null],
    ['already used', row({ usedAt: new Date('2026-10-02T09:00:00Z') })],
    ['expired', row({ expiresAt: new Date('2026-10-02T09:59:59Z') })],
  ])('refuses a %s token and changes nothing', async (_label, found) => {
    tokens.findUnique.mockResolvedValue(found);
    findUser.mockResolvedValue(account());

    expect(await confirmEmailVerification(rawToken, NOW)).toEqual({ ok: false });
    expect(updateUser).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it('refuses a token issued for an address the account no longer has', async () => {
    tokens.findUnique.mockResolvedValue(row({ emailHmac: 'hmac-of-an-older-address' }));
    findUser.mockResolvedValue(account());

    expect(await confirmEmailVerification(rawToken, NOW)).toEqual({ ok: false });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('loses the race cleanly when the token was spent between read and write', async () => {
    tokens.findUnique.mockResolvedValue(row());
    findUser.mockResolvedValue(account());
    tokens.updateMany.mockResolvedValue({ count: 0 });

    expect(await confirmEmailVerification(rawToken, NOW)).toEqual({ ok: false });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('refuses an empty token without touching the database', async () => {
    expect(await confirmEmailVerification('', NOW)).toEqual({ ok: false });
    expect(tokens.findUnique).not.toHaveBeenCalled();
  });
});
