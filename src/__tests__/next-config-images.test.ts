import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';

// Ticket 13 (GHSA-2xp9-vwfh-vxw4): Next 14.2.35's image optimizer can be driven
// to RCE by an AVIF input. Until Next is upgraded (ticket 15), the optimizer
// must stay off: with images.unoptimized, /_next/image answers 404 and every
// <Image> renders its src directly. Campaign and trip cover images accept any
// https URL, so a host allowlist could not keep untrusted input out.
describe('next.config.mjs image optimizer', () => {
  it('is turned off', () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it('allows no wildcard remote host', () => {
    const hosts = (nextConfig.images?.remotePatterns ?? []).map((p) => p.hostname);
    expect(hosts.filter((h) => h.includes('*'))).toEqual([]);
  });
});
