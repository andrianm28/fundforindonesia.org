import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHNAME_MAP, pathnames, PLANNED_INDONESIAN_RENAMES } from './pathnames';

describe('pathname map (ADR 0024 section 2)', () => {
  it("keeps today's Indonesian URL on the id side (the Q1 rename comes in a later PR)", () => {
    for (const row of PATHNAME_MAP) {
      expect(row.id, row.internal).toBe(row.internal);
    }
  });

  it('records exactly the eleven Indonesian URLs that Q1 will rename', () => {
    expect(PLANNED_INDONESIAN_RENAMES).toEqual({
      '/explore/all': '/jelajah/semua',
      '/explore/[category]': '/jelajah/[category]',
      '/campaign/[slug]/donate': '/campaign/[slug]/donasi',
      '/search': '/cari',
      '/about': '/tentang-kami',
      '/careers': '/karir',
      '/press': '/media',
      '/help': '/bantuan',
      '/contact': '/kontak',
      '/terms': '/syarat-dan-ketentuan',
      '/privacy': '/kebijakan-privasi',
    });
  });

  it('gives the English spellings from the ADR table', () => {
    expect(pathnames['/lupa-password']).toEqual({ id: '/lupa-password', en: '/forgot-password' });
    expect(pathnames['/sertifikat/[code]']).toEqual({ id: '/sertifikat/[code]', en: '/certificate/[code]' });
    expect(pathnames['/wakaf']).toEqual({ id: '/wakaf', en: '/waqf' });
    expect(pathnames['/hibah']).toBe('/hibah');
    expect(pathnames['/campaign/[slug]']).toBe('/campaign/[slug]');
  });

  it('keeps param names equal in both languages and never maps two pages to one path', () => {
    const params = (p: string) => p.match(/\[[^\]]+\]/g) ?? [];
    for (const row of PATHNAME_MAP) {
      expect(params(row.en), row.internal).toEqual(params(row.internal));
    }
    const ids = PATHNAME_MAP.map((r) => r.id);
    const ens = PATHNAME_MAP.map((r) => r.en);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ens).size).toBe(ens.length);
  });

  it('only names pages that exist (or are reserved by the ADR)', () => {
    const reserved = new Set(['/wakaf', '/hibah']);
    const groups = ['', '(auth)/', '(static)/'];
    for (const row of PATHNAME_MAP) {
      if (row.internal === '/') continue;
      const found = groups.some((g) =>
        existsSync(join(process.cwd(), 'src/app', g, row.internal.slice(1), 'page.tsx')),
      );
      expect(found || reserved.has(row.internal), row.internal).toBe(true);
    }
  });
});
