import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from './route';

/**
 * Asking for the claim link (prd-audit 08). Signed-in only, rate limited per
 * account, no body read, and the answer never says whether anything matches.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn() }));
vi.mock('@/lib/guest-claim-link', () => ({ requestGuestClaimLink: vi.fn() }));

import { getServerSession } from '@/lib/auth';
import { consumeRateLimit } from '@/lib/rate-limit';
import { requestGuestClaimLink } from '@/lib/guest-claim-link';

const session = getServerSession as unknown as Mock;
const limit = consumeRateLimit as unknown as Mock;
const request = requestGuestClaimLink as unknown as Mock;

beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue({ user: { id: 'user-1' } });
  limit.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 10 });
});

describe('POST /api/user/guest-claim', () => {
  it('refuses a caller who is not signed in, before counting or sending', async () => {
    session.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(limit).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('asks for the signed-in account only, counted per account', async () => {
    request.mockResolvedValue({ status: 'sent' });

    const res = await POST();

    expect(limit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: 'guest-claim-link', subject: 'user-1', limit: 3, windowSeconds: 3600 }),
    );
    expect(request).toHaveBeenCalledWith('user-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
  });

  it('answers 429 with Retry-After and sends nothing once over the limit', async () => {
    limit.mockResolvedValue({ allowed: false, count: 4, retryAfterSeconds: 120 });

    const res = await POST();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the rate limit store is down', async () => {
    limit.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST();

    expect(res.status).toBe(503);
    expect(request).not.toHaveBeenCalled();
  });

  it('answers 403 for an account whose email is not verified', async () => {
    request.mockResolvedValue({ status: 'unverified' });

    const res = await POST();

    expect(res.status).toBe(403);
  });

  it.each([
    ['not-found', 401],
    ['send-failed', 502],
  ])('maps %s to %i', async (status, code) => {
    request.mockResolvedValue({ status });

    expect((await POST()).status).toBe(code);
  });
});
