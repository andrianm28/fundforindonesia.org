import { describe, it, expect } from 'vitest';
import { stripLocalePrefix, pairedLocalePath } from './locale-path';

describe('stripLocalePrefix', () => {
  it('treats /en/... as the unprefixed path, and /en as the home page', () => {
    expect(stripLocalePrefix('/en/login')).toBe('/login');
    expect(stripLocalePrefix('/en/admin/payouts')).toBe('/admin/payouts');
    expect(stripLocalePrefix('/en')).toBe('/');
  });

  it('leaves unprefixed paths alone, including ones that merely start with the letters en', () => {
    expect(stripLocalePrefix('/login')).toBe('/login');
    expect(stripLocalePrefix('/')).toBe('/');
    expect(stripLocalePrefix('/engage')).toBe('/engage');
    expect(stripLocalePrefix('/english/x')).toBe('/english/x');
  });
});

describe('pairedLocalePath (language switcher target)', () => {
  it('pairs the Indonesian and English spellings of a page (Q7: /wakaf <-> /en/waqf)', () => {
    expect(pairedLocalePath('/wakaf', 'en')).toBe('/en/waqf');
    expect(pairedLocalePath('/en/waqf', 'id')).toBe('/wakaf');
    expect(pairedLocalePath('/', 'en')).toBe('/en');
    expect(pairedLocalePath('/en', 'id')).toBe('/');
  });

  it('carries dynamic segments across', () => {
    expect(pairedLocalePath('/sertifikat/AB12', 'en')).toBe('/en/certificate/AB12');
    expect(pairedLocalePath('/en/certificate/AB12', 'id')).toBe('/sertifikat/AB12');
    expect(pairedLocalePath('/campaign/halo-x1/donasi', 'en')).toBe('/en/campaign/halo-x1/donate');
    expect(pairedLocalePath('/en/campaign/halo-x1/donate', 'id')).toBe('/campaign/halo-x1/donasi');
  });

  it('has no counterpart for the back-office or for a path outside the map', () => {
    expect(pairedLocalePath('/admin', 'en')).toBeNull();
    expect(pairedLocalePath('/en/moderasi/x', 'id')).toBeNull();
    expect(pairedLocalePath('/tidak-ada', 'en')).toBeNull();
  });
});
