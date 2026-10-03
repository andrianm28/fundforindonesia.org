import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * A registered Donor asks to be anonymised from account settings (ticket 36;
 * PRD FFI-16). Only the signed-in owner, and only for themselves: the user id
 * comes from the session, never from the request.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/donor-anonymisation', () => ({ anonymiseRegisteredDonor: vi.fn() }));

import { getServerSession } from '@/lib/auth';
import { anonymiseRegisteredDonor } from '@/lib/donor-anonymisation';
import { AnonymisationBlockedByOpenRefundError } from '@/lib/money/errors';
import { POST } from './route';

const session = getServerSession as unknown as Mock;
const anonymise = anonymiseRegisteredDonor as unknown as Mock;

describe('POST /api/user/anonymise-donations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a request with no session and anonymises nothing', async () => {
    session.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(anonymise).not.toHaveBeenCalled();
  });

  it('anonymises the signed-in user and no one else: the route takes no user id from the request', async () => {
    session.mockResolvedValue({ user: { id: 'user-1' } });
    anonymise.mockResolvedValue({ status: 'anonymised', anonymisedCount: 3 });
    const response = await POST();
    expect(anonymise).toHaveBeenCalledWith(expect.anything(), { userId: 'user-1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'anonymised', anonymisedCount: 3 });
  });

  it('answers a repeat as success', async () => {
    session.mockResolvedValue({ user: { id: 'user-1' } });
    anonymise.mockResolvedValue({ status: 'already-anonymised', anonymisedCount: 0 });
    expect((await POST()).status).toBe(200);
  });

  it('answers an open Refund as its own typed 409', async () => {
    session.mockResolvedValue({ user: { id: 'user-1' } });
    anonymise.mockRejectedValue(new AnonymisationBlockedByOpenRefundError());
    const response = await POST();
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('ANONYMISATION_BLOCKED_BY_OPEN_REFUND');
  });
});
