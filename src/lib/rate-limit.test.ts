import { describe, it, expect, afterEach, vi } from 'vitest';
import { hashSubject } from './rate-limit';

afterEach(() => vi.unstubAllEnvs());

describe('hashSubject', () => {
  it('is a stable keyed hash that does not contain the address', () => {
    vi.stubEnv('RATE_LIMIT_SECRET', 'secret-one');
    const a = hashSubject('203.0.113.9');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(hashSubject('203.0.113.9'));
    expect(a).not.toContain('203');
    vi.stubEnv('RATE_LIMIT_SECRET', 'secret-two');
    expect(hashSubject('203.0.113.9')).not.toBe(a);
  });
  it('derives a key rather than using the raw secret as the HMAC key', async () => {
    const { createHmac } = await import('node:crypto');
    vi.stubEnv('RATE_LIMIT_SECRET', 'secret-one');
    const direct = createHmac('sha256', 'secret-one').update('rate-limit:203.0.113.9').digest('hex');
    expect(hashSubject('203.0.113.9')).not.toBe(direct);
  });
  it('refuses to hash in production with no secret configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RATE_LIMIT_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');
    expect(() => hashSubject('1.2.3.4')).toThrow();
  });
});
