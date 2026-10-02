import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

/**
 * Opening the confirmation link (prd-compliance 23). The token in the body is
 * the whole proof, so a bad one is one answer however it is bad, and the
 * confirmation is a POST so a mail scanner that merely fetches the link cannot
 * spend it.
 */

vi.mock('@/lib/email-verification', () => ({ confirmEmailVerification: vi.fn() }));

import { confirmEmailVerification } from '@/lib/email-verification';

const confirm = confirmEmailVerification as unknown as Mock;

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/user/email-verification/confirm', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => vi.resetAllMocks());

describe('POST /api/user/email-verification/confirm', () => {
  it('confirms a good token and reports how many gifts were claimed', async () => {
    confirm.mockResolvedValue({ ok: true, claimed: 2 });

    const res = await POST(post({ token: 'abc' }));

    expect(confirm).toHaveBeenCalledWith('abc');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true, claimed: 2 });
  });

  it('answers one 400 for any token that does not confirm', async () => {
    confirm.mockResolvedValue({ ok: false });

    const res = await POST(post({ token: 'nope' }));

    expect(res.status).toBe(400);
  });

  it.each([['not json'], [{}], [{ token: 7 }]])('answers 400 without confirming for %j', async (body) => {
    const res = await POST(post(body));

    expect(res.status).toBe(400);
    expect(confirm).not.toHaveBeenCalled();
  });
});
