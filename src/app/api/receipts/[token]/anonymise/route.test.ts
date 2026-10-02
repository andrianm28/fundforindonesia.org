import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * A Guest Donor asks to be anonymised from the link in their Receipt (ticket
 * 36; PRD FFI-16). The token is the only gate, so what this route must get
 * right is the answer for each outcome the module reports -- the removal
 * itself is proved against real Postgres in
 * src/__tests__/integration/donor-anonymisation.test.ts.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/donor-anonymisation', () => ({ anonymiseGuestDonor: vi.fn() }));

import { anonymiseGuestDonor } from '@/lib/donor-anonymisation';
import { AnonymisationBlockedByOpenRefundError } from '@/lib/money/errors';
import { POST } from './route';

const anonymise = anonymiseGuestDonor as unknown as Mock;

function call(token = 'tok-1', body: unknown = { email: 'donor@example.org' }) {
  return POST(
    new NextRequest(`http://localhost/api/receipts/${token}/anonymise`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

describe('POST /api/receipts/[token]/anonymise', () => {
  beforeEach(() => vi.clearAllMocks());

  it('anonymises by the token in the URL and the email in the body, and answers what changed', async () => {
    anonymise.mockResolvedValue({ status: 'anonymised', anonymisedCount: 1 });
    const response = await call('tok-9', { email: ' Donor@Example.org ' });
    expect(anonymise).toHaveBeenCalledWith(expect.anything(), { token: 'tok-9', email: ' Donor@Example.org ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'anonymised', anonymisedCount: 1 });
  });

  it.each([
    ['no body', ''],
    ['not JSON', 'bukan json'],
    ['no email', {}],
    ['a blank email', { email: '   ' }],
    ['an email that is not a string', { email: 42 }],
  ])('answers 400 and does nothing when the request has %s', async (_label, body) => {
    const response = await call('tok-1', body as unknown);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/email/i);
    expect(anonymise).not.toHaveBeenCalled();
  });

  it('answers 403 for an email that does not match, without saying which part was wrong', async () => {
    anonymise.mockResolvedValue({ status: 'email-mismatch' });
    const response = await call();
    expect(response.status).toBe(403);
    const { error } = await response.json();
    expect(error).toBe('Email tidak cocok dengan donasi ini.');
  });

  it('answers a repeat as success, so a double click is not an error', async () => {
    anonymise.mockResolvedValue({ status: 'already-anonymised', anonymisedCount: 0 });
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('already-anonymised');
  });

  it('answers 404 for an unknown token', async () => {
    anonymise.mockResolvedValue({ status: 'not-found' });
    expect((await call()).status).toBe(404);
  });

  it('answers 403 for a Donation that belongs to an account, and says where to go', async () => {
    anonymise.mockResolvedValue({ status: 'account-owned' });
    const response = await call();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('Pengaturan');
  });

  it('answers an open Refund as its own typed 409', async () => {
    anonymise.mockRejectedValue(new AnonymisationBlockedByOpenRefundError());
    const response = await call();
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('ANONYMISATION_BLOCKED_BY_OPEN_REFUND');
  });

  it('answers 500 without leaking the error for anything else', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    anonymise.mockRejectedValue(new Error('connection to db-prod-1 lost'));
    const response = await call();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('db-prod-1');
  });
});
