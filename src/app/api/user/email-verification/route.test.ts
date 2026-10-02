import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from './route';

/**
 * Asking for the confirmation link (prd-compliance 23). Signed-in only, and
 * the body is ignored: the link always goes to the account's own address, and
 * the answer never says whether any guest history matches.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/email-verification', () => ({ requestEmailVerification: vi.fn() }));

import { getServerSession } from '@/lib/auth';
import { requestEmailVerification } from '@/lib/email-verification';

const session = getServerSession as unknown as Mock;
const request = requestEmailVerification as unknown as Mock;

beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue({ user: { id: 'user-1' } });
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
});
