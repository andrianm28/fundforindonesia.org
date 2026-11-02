import { describe, it, expect, afterEach } from 'vitest';
import { routing } from './routing';
import { getPathname } from './navigation';
import { alternatesFor } from './metadata';
import { isLocalizedPath } from './scope';

describe('routing config (ADR 0024 section 2)', () => {
  it('has Indonesian unprefixed by default, English under /en, and nothing deciding the language but the URL', () => {
    expect(routing.locales).toEqual(['id', 'en']);
    expect(routing.defaultLocale).toBe('id');
    expect(routing.localePrefix).toBe('as-needed');
    expect(routing.localeDetection).toBe(false);
    expect(routing.localeCookie).toBe(false);
    expect(routing.alternateLinks).toBe(false);
  });
});

describe('getPathname', () => {
  it('leaves Indonesian URLs exactly as they are today', () => {
    expect(getPathname({ href: '/', locale: 'id' })).toBe('/');
    expect(getPathname({ href: '/about', locale: 'id' })).toBe('/about');
    expect(getPathname({ href: { pathname: '/campaign/[slug]/donate', params: { slug: 'a-1' } }, locale: 'id' })).toBe(
      '/campaign/a-1/donate',
    );
  });

  it('prefixes English with /en and uses the English spelling', () => {
    expect(getPathname({ href: '/', locale: 'en' })).toBe('/en');
    expect(getPathname({ href: '/lupa-password', locale: 'en' })).toBe('/en/forgot-password');
    expect(getPathname({ href: { pathname: '/sertifikat/[code]', params: { code: 'X1' } }, locale: 'en' })).toBe(
      '/en/certificate/X1',
    );
  });
});

describe('alternatesFor (canonical + hreflang)', () => {
  const saved = process.env.NEXT_PUBLIC_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = saved;
  });

  it('names itself as canonical in its own language and pairs id, en and x-default (the Indonesian URL)', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    const href = { pathname: '/lupa-password' } as const;
    expect(alternatesFor(href, 'id')).toEqual({
      canonical: 'https://fundforindonesia.org/lupa-password',
      languages: {
        id: 'https://fundforindonesia.org/lupa-password',
        en: 'https://fundforindonesia.org/en/forgot-password',
        'x-default': 'https://fundforindonesia.org/lupa-password',
      },
    });
    expect(alternatesFor(href, 'en').canonical).toBe('https://fundforindonesia.org/en/forgot-password');
  });

  it('handles the home page and params, and honours the configured base URL', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://example.test/';
    expect(alternatesFor({ pathname: '/' }, 'en')).toEqual({
      canonical: 'https://example.test/en',
      languages: {
        id: 'https://example.test/',
        en: 'https://example.test/en',
        'x-default': 'https://example.test/',
      },
    });
    expect(
      alternatesFor({ pathname: '/campaign/[slug]', params: { slug: 'abc-1' } }, 'id').languages.en,
    ).toBe('https://example.test/en/campaign/abc-1');
  });
});

describe('isLocalizedPath (what the language middleware may ever see)', () => {
  it.each(['/', '/about', '/en', '/en/about', '/campaign/x', '/administrasi'])('%s is localized', (p) => {
    expect(isLocalizedPath(p)).toBe(true);
  });

  it.each([
    '/admin',
    '/admin/users',
    '/moderasi',
    '/moderasi/campaign/1',
    '/api/health',
    '/_next/static/x.js',
    '/uploads/a.png',
    '/robots.txt',
    '/sitemap.xml',
    '/favicon.ico',
  ])('%s is not', (p) => {
    expect(isLocalizedPath(p)).toBe(false);
  });

  it('does not let /en reach the back-office either', () => {
    expect(isLocalizedPath('/en/admin')).toBe(false);
    expect(isLocalizedPath('/en/moderasi/x')).toBe(false);
  });
});
