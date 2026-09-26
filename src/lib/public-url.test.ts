import { describe, it, expect, vi, afterEach } from 'vitest';
import { publicUrl } from './public-url';

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
