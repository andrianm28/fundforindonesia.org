// @vitest-environment node
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';

// ci-cd-github-actions ticket 13 (GHSA-2xp9-vwfh-vxw4): the image optimizer
// stays off until Next is upgraded. The reasoning lives in next.config.mjs.
describe('next.config.mjs image optimizer', () => {
  it('is turned off', () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  // remotePatterns are unused while the optimizer is off. This guards the day
  // it is turned back on: `hostname: '**'` must not come back with it.
  it('allows no wildcard remote host', () => {
    const hosts = (nextConfig.images?.remotePatterns ?? []).map((p) => p.hostname);
    expect(hosts.filter((h) => h.includes('*'))).toEqual([]);
  });
});
