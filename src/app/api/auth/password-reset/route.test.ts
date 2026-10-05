// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Asking for a password reset link (rilis-1 93). Public, so it is the one
 * endpoint where "does this address have an account?" must never be
 * answerable: a known and an unknown address get the identical response, and
 * the limits count before any lookup or mail.
 */

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findFirst: vi.fn() } } }));
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn() }));
vi.mock('@/lib/mail', () => ({ sendReportingFailure: vi.fn() }));

import { POST } from './route';
import { RESET_REQUESTED_MESSAGE } from '@/lib/password-reset-copy';
import { prisma } from '@/lib/prisma';
import { consumeRateLimit } from '@/lib/rate-limit';
import { sendReportingFailure } from '@/lib/mail';
import { lookupUserEmail, sealUserEmail } from '@/lib/contact-fields';
import { checkPasswordResetToken } from '@/lib/password-reset';

const findUser = prisma.user.findFirst as unknown as Mock;
const consume = consumeRateLimit as unknown as Mock;
const send = sendReportingFailure as unknown as Mock;

const ALLOWED = { allowed: true, count: 1, retryAfterSeconds: 60 };
const EMAIL = 'Sari@Example.test';
const SECRET = 'route-test-secret-route-test-secret';

function account() {
  return { id: 'user-1', name: 'Sari', password: '$2b$12$' + 'a'.repeat(53), ...sealUserEmail(EMAIL) };
}

function request(body: unknown, ip = '203.0.113.7'): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const originalSecret = process.env.NEXTAUTH_SECRET;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXTAUTH_SECRET = SECRET;
  consume.mockResolvedValue(ALLOWED);
  send.mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = originalSecret;
});

describe('POST /api/auth/password-reset', () => {
  it('mails a reset link to an address that has an account', async () => {
    findUser.mockResolvedValue(account());

    const res = await POST(request({ email: EMAIL }));

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const [message, report] = send.mock.calls[0];
    expect(message.to).toBe(EMAIL);
    expect(report).toEqual({ mail: 'password_reset', userId: 'user-1' });
    expect(message.text).toContain('https://fundforindonesia.org/reset-password?token=');
  });

  it('mails a token that is valid for that account right now', async () => {
    const row = account();
    findUser.mockResolvedValue(row);

    await POST(request({ email: EMAIL }));

    const token = new URL(/https:\/\/\S+/.exec(send.mock.calls[0][0].text)![0]).searchParams.get('token')!;
    expect(
      checkPasswordResetToken(token, { id: 'user-1', password: row.password, emailHmac: row.emailHmac }, Date.now(), SECRET),
    ).toBe(true);
  });

  it('looks the account up by the email lookup HMAC, never by a scan', async () => {
    findUser.mockResolvedValue(null);

    await POST(request({ email: EMAIL }));

    expect(findUser).toHaveBeenCalledWith(expect.objectContaining({ where: lookupUserEmail(EMAIL) }));
  });

  it('answers a known and an unknown address with the same status and body, and mails only the known one', async () => {
    findUser.mockResolvedValueOnce(account());
    const known = await POST(request({ email: EMAIL }));
    expect(send).toHaveBeenCalledTimes(1);

    findUser.mockResolvedValueOnce(null);
    const unknown = await POST(request({ email: 'nobody@example.test' }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it('still answers the generic body when mail is not configured or fails', async () => {
    findUser.mockResolvedValue(account());
    send.mockResolvedValue(false);

    const res = await POST(request({ email: EMAIL }));

    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe(RESET_REQUESTED_MESSAGE);
  });

  it('answers the generic body even if the mail call rejects, and logs no address or token', async () => {
    findUser.mockResolvedValue(account());
    send.mockRejectedValue(new Error(`boom ${EMAIL}`));

    const res = await POST(request({ email: EMAIL }));
    await new Promise((r) => setTimeout(r, 0));

    expect(res.status).toBe(200);
    const logged = JSON.stringify((console.error as unknown as Mock).mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toMatch(/token=/);
  });

  it('counts the attempt per client address and per email lookup key, before any lookup', async () => {
    findUser.mockResolvedValue(null);

    await POST(request({ email: EMAIL }, '198.51.100.9'));

    const scopes = consume.mock.calls.map(([, input]) => input);
    expect(scopes).toContainEqual(expect.objectContaining({ scope: 'password-reset-request', subject: '198.51.100.9' }));
    expect(scopes).toContainEqual(
      expect.objectContaining({ scope: 'password-reset-request-email', subject: lookupUserEmail(EMAIL).emailHmac }),
    );
    expect(Math.max(...consume.mock.invocationCallOrder)).toBeLessThan(findUser.mock.invocationCallOrder[0]);
  });

  it('counts one address the same however it is typed', async () => {
    findUser.mockResolvedValue(null);

    await POST(request({ email: '  SARI@example.test ' }));
    await POST(request({ email: 'sari@EXAMPLE.test' }));

    const emailSubjects = consume.mock.calls
      .map(([, input]) => input)
      .filter((input) => input.scope === 'password-reset-request-email')
      .map((input) => input.subject);
    expect(new Set(emailSubjects).size).toBe(1);
  });

  it('answers 429 with Retry-After over the client limit, and looks nothing up', async () => {
    consume.mockResolvedValue({ allowed: false, count: 99, retryAfterSeconds: 42 });

    const res = await POST(request({ email: EMAIL }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(findUser).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 429 over the per-address limit, the same whether or not the address has an account', async () => {
    consume.mockImplementation(async (_db, input) =>
      input.scope === 'password-reset-request-email' ? { allowed: false, count: 9, retryAfterSeconds: 30 } : ALLOWED,
    );

    const res = await POST(request({ email: EMAIL }));

    expect(res.status).toBe(429);
    expect(findUser).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter is down: 503, no lookup, no mail', async () => {
    consume.mockRejectedValue(new Error('db down'));

    const res = await POST(request({ email: EMAIL }));

    expect(res.status).toBe(503);
    expect(findUser).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['not an email', { email: 'nope' }],
    ['missing', {}],
    ['not a string', { email: 42 }],
    ['an unparseable body', '{not json'],
  ])('answers 400 for %s, and mails nothing', async (_label, body) => {
    const res = await POST(request(body));

    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
    expect(findUser).not.toHaveBeenCalled();
  });
});
