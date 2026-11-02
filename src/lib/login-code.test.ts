import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * Login OTP: a 6-digit code mailed to an account's address. Stored only as a
 * keyed HMAC, one-use, short-lived, dead after too many wrong guesses, bound
 * to the address it was mailed to, and a newer code replaces older ones.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn(), updateMany: vi.fn() },
    loginCode: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/mail', () => ({ sendReportingFailure: vi.fn() }));

import {
  issueLoginCode,
  verifyLoginCode,
  hashLoginCode,
  LOGIN_CODE_TTL_MS,
  LOGIN_CODE_COOLDOWN_MS,
  LOGIN_CODE_MAX_ATTEMPTS,
} from './login-code';
import { sealUserEmail } from './contact-fields';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';

const users = prisma.user as unknown as Record<'findFirst' | 'updateMany', Mock>;
const codes = prisma.loginCode as unknown as Record<'findFirst' | 'create' | 'delete' | 'updateMany', Mock>;
const transaction = prisma.$transaction as unknown as Mock;
const send = sendReportingFailure as unknown as Mock;

const NOW = new Date('2026-11-02T10:00:00Z');
const SECRET = 'test-secret';

function account(overrides: Record<string, unknown> = {}) {
  return { id: 'user-1', name: 'Sari', emailVerifiedAt: null, ...sealUserEmail('sari@example.test'), ...overrides };
}

function liveCode(code: string, overrides: Record<string, unknown> = {}) {
  const a = account();
  return {
    id: 'code-1',
    userId: 'user-1',
    codeHash: hashLoginCode('user-1', code, SECRET),
    emailHmac: a.emailHmac,
    attempts: 0,
    expiresAt: new Date(NOW.getTime() + LOGIN_CODE_TTL_MS),
    usedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  send.mockResolvedValue(true);
  codes.findFirst.mockResolvedValue(null);
  codes.create.mockResolvedValue({ id: 'code-row' });
  codes.updateMany.mockResolvedValue({ count: 1 });
  users.updateMany.mockResolvedValue({ count: 1 });
});

describe('issueLoginCode', () => {
  it('mails a 6-digit code to the account address and stores only its hash', async () => {
    users.findFirst.mockResolvedValue(account());

    const result = await issueLoginCode('Sari@Example.test', NOW, SECRET);

    expect(result).toEqual({ status: 'sent' });
    const message = send.mock.calls[0][0];
    expect(message.to).toBe('sari@example.test');
    const code = /\b(\d{6})\b/.exec(message.text)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const stored = codes.create.mock.calls[0][0].data;
    expect(stored.codeHash).toBe(hashLoginCode('user-1', code!, SECRET));
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(stored.emailHmac).toBe(account().emailHmac);
    expect(stored.expiresAt).toEqual(new Date(NOW.getTime() + LOGIN_CODE_TTL_MS));
  });

  it('retires every older unused code of the account when a new one is issued', async () => {
    users.findFirst.mockResolvedValue(account());

    await issueLoginCode('sari@example.test', NOW, SECRET);

    expect(codes.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
      data: { usedAt: NOW },
    });
  });

  it('sends nothing for an address with no account', async () => {
    users.findFirst.mockResolvedValue(null);

    expect(await issueLoginCode('nobody@example.test', NOW, SECRET)).toEqual({ status: 'no-account' });
    expect(send).not.toHaveBeenCalled();
    expect(codes.create).not.toHaveBeenCalled();
  });

  it('refuses a second code inside the cooldown', async () => {
    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - LOGIN_CODE_COOLDOWN_MS + 1000) });

    expect(await issueLoginCode('sari@example.test', NOW, SECRET)).toEqual({ status: 'too-soon' });
    expect(send).not.toHaveBeenCalled();
  });

  it('removes the code again when the mail did not leave', async () => {
    users.findFirst.mockResolvedValue(account());
    send.mockResolvedValue(false);

    expect(await issueLoginCode('sari@example.test', NOW, SECRET)).toEqual({ status: 'send-failed' });
    expect(codes.delete).toHaveBeenCalledWith({ where: { id: 'code-row' } });
  });
});

describe('verifyLoginCode', () => {
  it('signs in with the right code, spends it, and marks the address verified', async () => {
    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue(liveCode('123456'));

    const user = await verifyLoginCode('sari@example.test', '123456', NOW, SECRET);

    expect(user).toEqual({ id: 'user-1', email: 'sari@example.test', name: 'Sari', image: null });
    expect(codes.updateMany).toHaveBeenCalledWith({
      where: { id: 'code-1', usedAt: null, expiresAt: { gt: NOW } },
      data: { usedAt: NOW },
    });
    expect(users.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', emailHmac: account().emailHmac, emailVerifiedAt: null },
      data: { emailVerifiedAt: NOW, password: null },
    });
  });

  it('accepts the code with surrounding spaces', async () => {
    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue(liveCode('123456'));

    expect(await verifyLoginCode('sari@example.test', ' 123 456 ', NOW, SECRET)).not.toBeNull();
  });

  it('claims an attempt atomically before comparing, and refuses a wrong code', async () => {
    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue(liveCode('123456'));

    expect(await verifyLoginCode('sari@example.test', '654321', NOW, SECRET)).toBeNull();
    expect(codes.updateMany).toHaveBeenCalledTimes(1);
    expect(codes.updateMany).toHaveBeenCalledWith({
      where: { id: 'code-1', usedAt: null, expiresAt: { gt: NOW }, attempts: { lt: LOGIN_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    expect(users.updateMany).not.toHaveBeenCalled();
  });

  it('refuses without comparing when a concurrent guess took the last attempt', async () => {
    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue(liveCode('123456', { attempts: LOGIN_CODE_MAX_ATTEMPTS - 1 }));
    codes.updateMany.mockResolvedValueOnce({ count: 0 });

    expect(await verifyLoginCode('sari@example.test', '123456', NOW, SECRET)).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses even the right code once the attempts are used up', async () => {
    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue(liveCode('123456', { attempts: LOGIN_CODE_MAX_ATTEMPTS }));

    expect(await verifyLoginCode('sari@example.test', '123456', NOW, SECRET)).toBeNull();
  });

  it('refuses an expired code', async () => {
    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue(liveCode('123456', { expiresAt: NOW }));

    expect(await verifyLoginCode('sari@example.test', '123456', NOW, SECRET)).toBeNull();
  });

  it('refuses a code mailed to an address the account no longer has', async () => {
    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue(liveCode('123456', { emailHmac: 'old-address-hmac' }));

    expect(await verifyLoginCode('sari@example.test', '123456', NOW, SECRET)).toBeNull();
  });

  it('refuses when a concurrent request spent the code first', async () => {
    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue(liveCode('123456'));
    codes.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    expect(await verifyLoginCode('sari@example.test', '123456', NOW, SECRET)).toBeNull();
  });

  it('refuses malformed input without touching the database', async () => {
    expect(await verifyLoginCode('sari@example.test', '12345', NOW, SECRET)).toBeNull();
    expect(await verifyLoginCode('sari@example.test', 'abcdef', NOW, SECRET)).toBeNull();
    expect(users.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an address with no account or no live code', async () => {
    users.findFirst.mockResolvedValue(null);
    expect(await verifyLoginCode('nobody@example.test', '123456', NOW, SECRET)).toBeNull();

    users.findFirst.mockResolvedValue(account());
    codes.findFirst.mockResolvedValue(null);
    expect(await verifyLoginCode('sari@example.test', '123456', NOW, SECRET)).toBeNull();
  });

  it('a code hashed for one account does not verify for another', () => {
    expect(hashLoginCode('user-1', '123456', SECRET)).not.toBe(hashLoginCode('user-2', '123456', SECRET));
  });
});
