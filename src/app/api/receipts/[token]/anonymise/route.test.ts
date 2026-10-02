import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * A Guest Donor asks to be anonymised from the link in their Receipt (ticket
 * 36; PRD FFI-16). The token is the only gate, so what this route must get
 * right is the answer for each outcome the module reports -- the removal
 * itself is proved against real Postgres in
 * src/__tests__/integration/donor-anonymisation.test.ts.
 */

const limiter = vi.hoisted(() => ({ buckets: new Map<string, number>(), failure: null as Error | null, seen: [] as unknown[][] }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // consumeRateLimit's one atomic statement: bump the bucket, answer the count.
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      limiter.seen.push(values);
      if (limiter.failure) throw limiter.failure;
      const key = `${values[0]}:${values[1]}`;
      const count = (limiter.buckets.get(key) ?? 0) + 1;
      limiter.buckets.set(key, count);
      return [{ count }];
    },
    $executeRaw: async () => 0,
  },
}));
vi.mock('@/lib/donor-anonymisation', () => ({ anonymiseGuestDonor: vi.fn() }));

import { anonymiseGuestDonor } from '@/lib/donor-anonymisation';
import { AnonymisationBlockedByOpenRefundError } from '@/lib/money/errors';
import { POST } from './route';

// The route's limit (a named constant there, not a route export): 5 per hour.
const ANONYMISE_GUESS_LIMIT = 5;
const anonymise = anonymiseGuestDonor as unknown as Mock;

function call(token = 'tok-1', body: unknown = { email: 'donor@example.org' }, ip = '203.0.113.9') {
  return POST(
    new NextRequest(`http://localhost/api/receipts/${token}/anonymise`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

describe('POST /api/receipts/[token]/anonymise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limiter.buckets = new Map();
    limiter.failure = null;
    limiter.seen = [];
  });

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

  describe('guess limit on the email', () => {
    it('refuses with a 429 in Indonesian after the limit, and stops calling the module', async () => {
      anonymise.mockResolvedValue({ status: 'email-mismatch' });
      for (let i = 0; i < ANONYMISE_GUESS_LIMIT; i++) expect((await call()).status).toBe(403);

      const response = await call();
      expect(response.status).toBe(429);
      expect((await response.json()).error).toMatch(/terlalu banyak percobaan/i);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(anonymise).toHaveBeenCalledTimes(ANONYMISE_GUESS_LIMIT);
    });

    it('counts per Receipt token and per client address, not globally', async () => {
      anonymise.mockResolvedValue({ status: 'email-mismatch' });
      for (let i = 0; i < ANONYMISE_GUESS_LIMIT; i++) await call('tok-1');

      expect((await call('tok-1')).status).toBe(429);
      expect((await call('tok-2')).status).toBe(403);
      expect((await call('tok-1', { email: 'donor@example.org' }, '198.51.100.7')).status).toBe(403);
    });

    it('never hands the raw token or client address to the limiter store', async () => {
      anonymise.mockResolvedValue({ status: 'email-mismatch' });
      await call('tok-secret-77', { email: 'donor@example.org' }, '203.0.113.99');

      expect(limiter.seen.length).toBeGreaterThan(0);
      const sent = JSON.stringify(limiter.seen);
      expect(sent).not.toContain('tok-secret-77');
      expect(sent).not.toContain('203.0.113.99');
    });

    it('does not count a request that has no email', async () => {
      anonymise.mockResolvedValue({ status: 'email-mismatch' });
      for (let i = 0; i < ANONYMISE_GUESS_LIMIT + 2; i++) expect((await call('tok-1', {})).status).toBe(400);
      expect((await call('tok-1')).status).toBe(403);
    });

    it('fails open when the limiter store is down, and logs by error class only', async () => {
      const lines: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
      limiter.failure = new Error('connection to db-prod-1 lost');
      anonymise.mockResolvedValue({ status: 'anonymised', anonymisedCount: 1 });

      expect((await call()).status).toBe(200);
      expect(lines.join('\n')).toContain('rate_limit_unavailable');
      expect(lines.join('\n')).not.toContain('db-prod-1');
    });
  });
});
