import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * The claim link (prd-audit 08): a signed-in account with a verified address
 * asks for a one-use, 24 hour link to its own inbox; opening it, signed in as
 * the same account, links the Guest Donations under that address. The token is
 * stored hashed, the request names no address, and every refusal changes
 * nothing (the token stays unspent).
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    guestClaimToken: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/mail', () => ({ sendReportingFailure: vi.fn() }));
vi.mock('@/lib/guest-donation-claim', () => ({ claimGuestDonations: vi.fn() }));

import { confirmGuestClaimLink, requestGuestClaimLink, GUEST_CLAIM_TTL_MS } from './guest-claim-link';
import { sealUserEmail } from './contact-fields';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';
import { claimGuestDonations } from '@/lib/guest-donation-claim';

const findUser = prisma.user.findUnique as unknown as Mock;
const findUserWhere = prisma.user.findFirst as unknown as Mock;
const transaction = prisma.$transaction as unknown as Mock;
const tokens = prisma.guestClaimToken as unknown as Record<'findUnique' | 'create' | 'delete' | 'updateMany', Mock>;
const send = sendReportingFailure as unknown as Mock;
const claim = claimGuestDonations as unknown as Mock;

const NOW = new Date('2026-10-03T10:00:00Z');
const TOKEN = 'A'.repeat(43);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
let rolledBack = false;

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    name: 'Sari',
    emailVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    ...sealUserEmail('sari@example.test'),
    ...overrides,
  };
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    userId: 'user-1',
    emailHmac: 'hmac-1',
    emailHmacKeyId: 'k1',
    usedAt: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  rolledBack = false;
  transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
    try {
      return await fn(prisma);
    } catch (error) {
      rolledBack = true;
      throw error;
    }
  });
  send.mockResolvedValue(true);
  tokens.create.mockResolvedValue({ id: 'tok-row' });
  tokens.updateMany.mockResolvedValue({ count: 1 });
  findUserWhere.mockResolvedValue({ id: 'user-1' });
  claim.mockResolvedValue({ verified: true, claimed: 2 });
});

describe('requestGuestClaimLink', () => {
  it('mails a link to the account address, storing only the hash, valid for 24 hours', async () => {
    findUser.mockResolvedValue(account({ emailHmac: 'hmac-1', emailHmacKeyId: 'k1' }));

    const result = await requestGuestClaimLink('user-1', NOW);

    expect(result).toEqual({ status: 'sent' });
    const data = tokens.create.mock.calls[0][0].data;
    expect(data.userId).toBe('user-1');
    expect(data.emailHmac).toBe('hmac-1');
    expect(data.emailHmacKeyId).toBe('k1');
    expect(data.expiresAt).toEqual(new Date(NOW.getTime() + GUEST_CLAIM_TTL_MS));
    expect(GUEST_CLAIM_TTL_MS).toBe(24 * 60 * 60 * 1000);

    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe('sari@example.test');
    const raw = /token=([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
    expect(raw).toBeDefined();
    expect(data.tokenHash).toBe(sha(raw!));
    expect(JSON.stringify(data)).not.toContain(raw);
    expect(JSON.stringify(data)).not.toContain('sari@example.test');
  });

  it('refuses an account whose email is not verified, sending and storing nothing', async () => {
    findUser.mockResolvedValue(account({ emailVerifiedAt: null }));

    expect(await requestGuestClaimLink('user-1', NOW)).toEqual({ status: 'unverified' });
    expect(tokens.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('answers not-found for an unknown account', async () => {
    findUser.mockResolvedValue(null);

    expect(await requestGuestClaimLink('ghost', NOW)).toEqual({ status: 'not-found' });
  });

  it('removes the token when the mail does not leave', async () => {
    findUser.mockResolvedValue(account());
    send.mockResolvedValue(false);

    expect(await requestGuestClaimLink('user-1', NOW)).toEqual({ status: 'send-failed' });
    expect(tokens.delete).toHaveBeenCalledWith({ where: { id: 'tok-row' } });
  });
});

describe('confirmGuestClaimLink', () => {
  it('spends the token and claims in one transaction', async () => {
    tokens.findUnique.mockResolvedValue(tokenRow());

    const result = await confirmGuestClaimLink('user-1', TOKEN, NOW);

    expect(result).toEqual({ ok: true, claimed: 2 });
    expect(tokens.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha(TOKEN) } });
    expect(tokens.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok-1', usedAt: null, expiresAt: { gt: NOW } },
      data: { usedAt: NOW },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith('user-1', prisma);
  });

  it.each([
    ['malformed', 'short', null],
    ['unknown', TOKEN, null],
    ['spent', TOKEN, tokenRow({ usedAt: new Date('2026-10-03T09:00:00Z') })],
    ['expired', TOKEN, tokenRow({ expiresAt: new Date(NOW.getTime() - 1) })],
    ['expired exactly now', TOKEN, tokenRow({ expiresAt: NOW })],
    ['issued to another account', TOKEN, tokenRow({ userId: 'user-2' })],
  ])('refuses a %s token without writing', async (_name, token, row) => {
    tokens.findUnique.mockResolvedValue(row);

    expect(await confirmGuestClaimLink('user-1', token, NOW)).toEqual({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it('refuses and rolls back when a concurrent open already spent the token', async () => {
    tokens.findUnique.mockResolvedValue(tokenRow());
    tokens.updateMany.mockResolvedValue({ count: 0 });

    expect(await confirmGuestClaimLink('user-1', TOKEN, NOW)).toEqual({ ok: false });
    expect(claim).not.toHaveBeenCalled();
  });

  it('refuses and rolls back when the address or its key id changed since issue', async () => {
    tokens.findUnique.mockResolvedValue(tokenRow());
    findUserWhere.mockResolvedValue(null);

    expect(await confirmGuestClaimLink('user-1', TOKEN, NOW)).toEqual({ ok: false });
    expect(findUserWhere).toHaveBeenCalledWith({
      where: { id: 'user-1', emailHmac: 'hmac-1', emailHmacKeyId: 'k1', emailVerifiedAt: { not: null } },
      select: { id: true },
    });
    expect(rolledBack).toBe(true);
    expect(claim).not.toHaveBeenCalled();
  });

  it('rolls back the spent token when the account is no longer verified', async () => {
    tokens.findUnique.mockResolvedValue(tokenRow());
    claim.mockResolvedValue({ verified: false, claimed: 0 });

    expect(await confirmGuestClaimLink('user-1', TOKEN, NOW)).toEqual({ ok: false });
    expect(rolledBack).toBe(true);
  });

  it('reports zero when nothing matches, still spending the token', async () => {
    tokens.findUnique.mockResolvedValue(tokenRow());
    claim.mockResolvedValue({ verified: true, claimed: 0 });

    expect(await confirmGuestClaimLink('user-1', TOKEN, NOW)).toEqual({ ok: true, claimed: 0 });
  });
});
