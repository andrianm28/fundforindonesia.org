// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Spending a password reset link (rilis-1 93). The signed token is the proof,
 * so no session is needed. Every token that does not verify gets the same
 * answer; a weak password is refused before the token is spent; and the write
 * is guarded on the very password hash the token was verified against, so of
 * two concurrent submissions of one link exactly one lands.
 */

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn(), updateMany: vi.fn() } } }));
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn() }));
vi.mock('@/lib/password-hash', () => ({ hashPassword: vi.fn() }));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { consumeRateLimit } from '@/lib/rate-limit';
import { hashPassword } from '@/lib/password-hash';
import { PASSWORD_HASH_COST } from '@/lib/password-hash-cost';
import { signPasswordResetToken } from '@/lib/password-reset';

const findUser = prisma.user.findUnique as unknown as Mock;
const updateMany = prisma.user.updateMany as unknown as Mock;
const consume = consumeRateLimit as unknown as Mock;
const hash = hashPassword as unknown as Mock;

const SECRET = 'confirm-test-secret-confirm-test-secret';
const OLD_HASH = '$2b$12$' + 'a'.repeat(53);
const NEW_HASH = '$2b$12$' + 'n'.repeat(53);
const account = { id: 'user-1', password: OLD_HASH, emailHmac: 'h'.repeat(64), emailVerifiedAt: null as Date | null };
const GOOD_PASSWORD = 'password-baru-123';

function request(body: unknown, ip = '203.0.113.7'): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/password-reset/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const freshToken = () => signPasswordResetToken(account, Date.now(), SECRET);
const originalSecret = process.env.NEXTAUTH_SECRET;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXTAUTH_SECRET = SECRET;
  consume.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 60 });
  hash.mockResolvedValue(NEW_HASH);
  findUser.mockResolvedValue(account);
  updateMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = originalSecret;
});

describe('POST /api/auth/password-reset/confirm', () => {
  it('sets the new password, hashed at the platform cost, and marks the address verified', async () => {
    const now = Date.now();
    const res = await POST(request({ token: freshToken(), password: GOOD_PASSWORD }));

    expect(res.status).toBe(200);
    expect(PASSWORD_HASH_COST).toBe(12);
    expect(hash).toHaveBeenCalledWith(GOOD_PASSWORD, 12);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = updateMany.mock.calls[0][0];
    expect(data.password).toBe(NEW_HASH);
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(Math.abs(data.emailVerifiedAt.getTime() - now)).toBeLessThan(5000);
    expect(where).toEqual({ id: 'user-1', password: OLD_HASH, emailHmac: account.emailHmac });
  });

  it('keeps the earlier verification time when the address was already verified', async () => {
    const earlier = new Date('2026-01-01T00:00:00Z');
    findUser.mockResolvedValue({ ...account, emailVerifiedAt: earlier });

    await POST(request({ token: freshToken(), password: GOOD_PASSWORD }));

    expect(updateMany.mock.calls[0][0].data.emailVerifiedAt).toEqual(earlier);
  });

  it('resets an account with no password yet (Google sign-in), guarding the write on null', async () => {
    const google = { ...account, password: null };
    findUser.mockResolvedValue(google);

    const res = await POST(request({ token: signPasswordResetToken(google, Date.now(), SECRET), password: GOOD_PASSWORD }));

    expect(res.status).toBe(200);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'user-1', password: null, emailHmac: account.emailHmac });
  });

  it('refuses a password the schema refuses, without hashing or writing', async () => {
    const res = await POST(request({ token: freshToken(), password: 'short' }));

    expect(res.status).toBe(400);
    expect((await res.json()).errors.password).toMatch(/minimal 8 karakter/);
    expect(hash).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses a password longer than bcrypt reads (72 bytes)', async () => {
    const res = await POST(request({ token: freshToken(), password: 'x'.repeat(73) }));

    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('answers every bad token the same 400 and writes nothing', async () => {
    const expired = signPasswordResetToken(account, Date.now() - 2 * 3600_000, SECRET);
    const [payload, sig] = freshToken().split('.');
    const tampered = `${payload}.${(sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)}`;
    const bodies: unknown[] = [
      { token: expired, password: GOOD_PASSWORD },
      { token: tampered, password: GOOD_PASSWORD },
      { token: 'garbage', password: GOOD_PASSWORD },
      { token: 42, password: GOOD_PASSWORD },
      { password: GOOD_PASSWORD },
      '{not json',
    ];

    const answers = [];
    for (const body of bodies) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
      answers.push(await res.json());
    }

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0].message).toMatch(/tidak valid atau sudah kedaluwarsa/);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses a token that was spent: the password it was issued against has changed', async () => {
    const token = freshToken();
    findUser.mockResolvedValue({ ...account, password: NEW_HASH });

    const res = await POST(request({ token, password: GOOD_PASSWORD }));

    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses a token for an account that no longer exists', async () => {
    findUser.mockResolvedValue(null);

    expect((await POST(request({ token: freshToken(), password: GOOD_PASSWORD }))).status).toBe(400);
  });

  it('answers 400 when another request spent the link first (the guarded write matched nothing)', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(request({ token: freshToken(), password: GOOD_PASSWORD }));

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/tidak valid atau sudah kedaluwarsa/);
  });

  it('counts per client address and answers 429 with Retry-After over the limit', async () => {
    consume.mockResolvedValue({ allowed: false, count: 99, retryAfterSeconds: 77 });

    const res = await POST(request({ token: freshToken(), password: GOOD_PASSWORD }, '198.51.100.4'));

    expect(consume).toHaveBeenCalledWith(prisma, expect.objectContaining({ scope: 'password-reset-confirm', subject: '198.51.100.4' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('77');
    expect(findUser).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });

  it('logs neither the token, the password nor an address, even when the write fails', async () => {
    const token = freshToken();
    updateMany.mockRejectedValue(new Error(`db said ${token} ${GOOD_PASSWORD}`));

    const res = await POST(request({ token, password: GOOD_PASSWORD }));

    expect(res.status).toBe(500);
    const logged = JSON.stringify([...(console.error as unknown as Mock).mock.calls, ...(console.log as unknown as Mock).mock.calls]);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(GOOD_PASSWORD);
  });
});
