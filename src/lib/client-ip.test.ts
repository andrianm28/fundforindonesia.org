import { describe, it, expect, afterEach, vi } from 'vitest';
import { clientAddress } from './client-ip';

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

describe('clientAddress, IPv6 and mapped IPv4', () => {
  it('maps an IPv4-mapped IPv6 address to its IPv4 form', () => {
    expect(clientAddress(h('::ffff:203.0.113.9'))).toBe('203.0.113.9');
    expect(clientAddress(h('::FFFF:203.0.113.9'))).toBe('203.0.113.9');
  });
  it('keys an IPv6 client by its /64 prefix, so rotating the host part does not dodge the limit', () => {
    const a = clientAddress(h('2001:db8:1:2:aaaa:bbbb:cccc:dddd'));
    const b = clientAddress(h('2001:DB8:1:2::1'));
    const c = clientAddress(h('2001:db8:1:3::1'));
    expect(a).toBe('2001:db8:1:2::/64');
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
  it('expands :: correctly when it falls inside the prefix', () => {
    expect(clientAddress(h('2001:db8::1'))).toBe('2001:db8:0:0::/64');
    expect(clientAddress(h('::1'))).toBe('0:0:0:0::/64');
  });
});
