import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

/**
 * Opening the claim link (prd-audit 08). The token claims only for the
 * signed-in account it was issued to, and a bad one is one answer however it
 * is bad.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/guest-claim-link', () => ({ confirmGuestClaimLink: vi.fn(), GUEST_CLAIM_TOKEN_LENGTH: 43 }));

import { getServerSession } from '@/lib/auth';
import { confirmGuestClaimLink } from '@/lib/guest-claim-link';

const session = getServerSession as unknown as Mock;
const confirm = confirmGuestClaimLink as unknown as Mock;
const TOKEN = 'A'.repeat(43);

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/user/guest-claim/confirm', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('POST /api/user/guest-claim/confirm', () => {
  it('claims for the signed-in account and reports how many Donations were linked', async () => {
    confirm.mockResolvedValue({ ok: true, claimed: 3 });

    const res = await POST(post({ token: TOKEN }));

    expect(confirm).toHaveBeenCalledWith('user-1', TOKEN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 3 });
  });

  it('refuses a caller who is not signed in without touching the token', async () => {
    session.mockResolvedValue(null);

    const res = await POST(post({ token: TOKEN }));

    expect(res.status).toBe(401);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('answers one 400 for any token that does not claim (spent, expired, another account)', async () => {
    confirm.mockResolvedValue({ ok: false });

    const res = await POST(post({ token: TOKEN }));

    expect(res.status).toBe(400);
  });

  it.each([['not json'], [{}], [{ token: 7 }], [{ token: '' }], [{ token: 'A'.repeat(42) }], [{ token: 'A'.repeat(44) }]])(
    'answers 400 without claiming for %j',
    async (body) => {
      const res = await POST(post(body));

      expect(res.status).toBe(400);
      expect(confirm).not.toHaveBeenCalled();
    },
  );
});
