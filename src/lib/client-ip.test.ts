import { describe, it, expect, afterEach, vi } from 'vitest';
import { clientAddress, hashSubject } from './client-ip';

afterEach(() => vi.unstubAllEnvs());

const h = (xff?: string) => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff });

describe('clientAddress', () => {
  it('takes the entry the one trusted proxy appended, not what the client claimed', () => {
    expect(clientAddress(h('6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientAddress(h('203.0.113.9'))).toBe('203.0.113.9');
  });
  it('honours TRUSTED_PROXY_HOPS for a longer proxy chain', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
    expect(clientAddress(h('6.6.6.6, 203.0.113.9, 10.0.0.2'))).toBe('203.0.113.9');
  });
  it('falls into one shared bucket when there is no usable header', () => {
    expect(clientAddress(h())).toBe('unknown');
    expect(clientAddress(h(''))).toBe('unknown');
  });
});

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
  it('refuses to hash in production with no secret configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RATE_LIMIT_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');
    expect(() => hashSubject('1.2.3.4')).toThrow();
  });
});
