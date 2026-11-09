// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Asking for a sign-in code (login OTP). Public, so "does this address have an
 * account?" must never be answerable: a known and an unknown address get the
 * identical response, and the limits count before any lookup or mail. It
 * sends email, so a limiter outage refuses rather than relays.
 */

vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn() }));
vi.mock('@/lib/login-code', () => ({ issueLoginCode: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { POST } from './route';
import { consumeRateLimit } from '@/lib/rate-limit';
import { issueLoginCode } from '@/lib/login-code';
import { currentEmailHmac } from '@/lib/contact-fields';

const consume = consumeRateLimit as unknown as Mock;
const issue = issueLoginCode as unknown as Mock;

const ALLOWED = { allowed: true, count: 1, retryAfterSeconds: 60 };

function request(body: unknown, ip = '203.0.113.7'): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/login-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  consume.mockResolvedValue(ALLOWED);
  issue.mockResolvedValue({ status: 'sent' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/auth/login-code', () => {
  it('issues a code for the typed address', async () => {
    const res = await POST(request({ email: ' Sari@Example.test ' }));

    expect(res.status).toBe(200);
    expect(issue).toHaveBeenCalledWith('Sari@Example.test');
  });

  it('answers a known and an unknown address identically', async () => {
    const known = await POST(request({ email: 'sari@example.test' }));
    issue.mockResolvedValue({ status: 'no-account' });
    const unknown = await POST(request({ email: 'nobody@example.test' }));

    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it('answers the cooldown and a failed send the same way too', async () => {
    const sent = await (await POST(request({ email: 'sari@example.test' }))).json();
    issue.mockResolvedValue({ status: 'too-soon' });
    const soon = await (await POST(request({ email: 'sari@example.test' }))).json();
    issue.mockResolvedValue({ status: 'send-failed' });
    const failed = await (await POST(request({ email: 'sari@example.test' }))).json();

    expect(soon).toEqual(sent);
    expect(failed).toEqual(sent);
  });

  it('rejects a malformed address without issuing', async () => {
    const res = await POST(request({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(issue).not.toHaveBeenCalled();
  });

  it('counts per client and per address before issuing', async () => {
    await POST(request({ email: 'Sari@Example.test' }));

    const scopes = consume.mock.calls.map((c) => [c[1].scope, c[1].subject]);
    expect(scopes).toEqual([
      ['login-code-request', '203.0.113.7'],
      ['login-code-request-email', currentEmailHmac('Sari@Example.test')],
    ]);
  });

  it('refuses with 429 once limited, without issuing', async () => {
    consume.mockResolvedValue({ allowed: false, count: 11, retryAfterSeconds: 120 });

    const res = await POST(request({ email: 'sari@example.test' }));

    expect(res.status).toBe(429);
    expect(issue).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter is down', async () => {
    consume.mockRejectedValue(new Error('db down'));

    const res = await POST(request({ email: 'sari@example.test' }));

    expect(res.status).toBe(503);
    expect(issue).not.toHaveBeenCalled();
  });
});
