import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from './route';

/**
 * Asking for the confirmation link (prd-compliance 23). Signed-in only, and
 * the body is ignored: the link always goes to the account's own address, and
 * the answer never says whether any guest history matches.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/email-verification', () => ({ requestEmailVerification: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn() }));

import { getServerSession } from '@/lib/auth';
import { requestEmailVerification } from '@/lib/email-verification';
import { consumeRateLimit } from '@/lib/rate-limit';

const session = getServerSession as unknown as Mock;
const request = requestEmailVerification as unknown as Mock;
const consume = consumeRateLimit as unknown as Mock;

beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue({ user: { id: 'user-1' } });
  consume.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 60 });
});

describe('POST /api/user/email-verification', () => {
  it('refuses a caller who is not signed in', async () => {
    session.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });

  it('asks for the signed-in account only and answers 200 when the link is sent', async () => {
    request.mockResolvedValue({ status: 'sent' });

    const res = await POST();

    expect(request).toHaveBeenCalledWith('user-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
  });

  it('says so when the account is already verified', async () => {
    request.mockResolvedValue({ status: 'already-verified' });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true });
  });

  it('answers 429 inside the cooldown', async () => {
    request.mockResolvedValue({ status: 'too-soon' });

    expect((await POST()).status).toBe(429);
  });

  it('answers 502 when the mail was not delivered', async () => {
    request.mockResolvedValue({ status: 'send-failed' });

    expect((await POST()).status).toBe(502);
  });

  it('answers 429 with Retry-After over the rate limit, and sends nothing', async () => {
    consume.mockResolvedValue({ allowed: false, count: 99, retryAfterSeconds: 123 });

    const res = await POST();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('123');
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter is down: 503 and no mail', async () => {
    consume.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST();

    expect(res.status).toBe(503);
    expect(request).not.toHaveBeenCalled();
  });
});
