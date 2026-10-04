import { describe, it, expect, afterEach, vi } from 'vitest';
import robots from './robots';

const PRIVATE = [
  '/admin',
  '/moderasi',
  '/api',
  '/akun',
  '/donasi-saya',
  '/inbox',
  '/campaign/create',
  '/volunteer-trip/registrasi',
  '/receipt/',
  '/akad-wakaf/',
  '/sertifikat/',
];

function firstRule() {
  const rules = robots().rules;
  return Array.isArray(rules) ? rules[0] : rules;
}

function disallowed(): string[] {
  const d = firstRule().disallow;
  return Array.isArray(d) ? d : d ? [d] : [];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('robots.txt', () => {
  it('blocks every private or tokenised path for all crawlers', () => {
    expect(firstRule().userAgent).toBe('*');
    for (const path of PRIVATE) expect(disallowed()).toContain(path);
  });

  it('does not block pages the sitemap lists', () => {
    const blocked = disallowed();
    for (const path of ['/', '/explore/all', '/zakat', '/login', '/register', '/campaign/some-slug']) {
      expect(blocked.some((b) => path.startsWith(b))).toBe(false);
    }
  });

  it('points at the sitemap on the canonical public site', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    const r = robots();
    expect(r.sitemap).toBe('https://fundforindonesia.org/sitemap.xml');
    expect(r.host).toBe('https://fundforindonesia.org');
  });
});
