import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCanonicalSite, publicUrl } from './public-url';

/**
 * Every absolute link to the public site (SEO metadata, the sitemap, the
 * Campaign page, email) starts from one address: NEXT_PUBLIC_BASE_URL, or
 * https://fundforindonesia.org when it is unset. fundforindonesia.com has no
 * DNS, so it must never be the fallback.
 */
describe('publicUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to https://fundforindonesia.org when NEXT_PUBLIC_BASE_URL is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');

    expect(publicUrl()).toBe('https://fundforindonesia.org');
    expect(publicUrl('/campaign/bantu-anak-yatim')).toBe(
      'https://fundforindonesia.org/campaign/bantu-anak-yatim'
    );
  });

  it('uses NEXT_PUBLIC_BASE_URL, without its trailing slash', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://staging.example.test/');

    expect(publicUrl()).toBe('https://staging.example.test');
    expect(publicUrl('/zakat')).toBe('https://staging.example.test/zakat');
  });

  it('never falls back to NEXTAUTH_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');

    expect(publicUrl()).toBe('https://fundforindonesia.org');
  });
});

/**
 * Staging (stg.fundforindonesia.org) and a thread's local dev server are built
 * with their own NEXT_PUBLIC_BASE_URL. Only the canonical domain may be
 * indexed; everything else asks crawlers to stay out (robots.ts, layout.tsx).
 */
describe('isCanonicalSite', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true for the canonical domain, set or by fallback, with or without a trailing slash', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    expect(isCanonicalSite()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://fundforindonesia.org/');
    expect(isCanonicalSite()).toBe(true);
  });

  it('is false for staging, localhost or any other host', () => {
    for (const url of ['https://stg.fundforindonesia.org', 'http://localhost:3000', 'https://fundforindonesia.org.evil.test']) {
      vi.stubEnv('NEXT_PUBLIC_BASE_URL', url);
      expect(isCanonicalSite(), url).toBe(false);
    }
  });
});
