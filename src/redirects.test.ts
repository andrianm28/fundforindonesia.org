import { describe, it, expect } from 'vitest';
import nextConfig from '../next.config.mjs';
import { INDONESIAN_RENAMES } from '@/i18n/pathnames';

type Redirect = { source: string; destination: string; permanent?: boolean; statusCode?: number };

/** `/campaign/[slug]/donate` -> `/campaign/:slug/donate`, the syntax next.config uses. */
const toSource = (path: string) => path.replace(/\[([^\]]+)\]/g, ':$1');

async function redirects(): Promise<Redirect[]> {
  return (nextConfig as unknown as { redirects: () => Promise<Redirect[]> }).redirects();
}

describe('Q1 Indonesian renames: old URL -> new URL', () => {
  it('has one permanent (308) redirect for every rename, keeping dynamic segments', async () => {
    const list = await redirects();
    for (const [old, renamed] of Object.entries(INDONESIAN_RENAMES)) {
      const hit = list.find((r) => r.source === toSource(old));
      expect(hit, old).toBeDefined();
      expect(hit!.destination).toBe(toSource(renamed));
      // permanent: true is a 308 in Next (a 301 would need statusCode).
      expect(hit!.permanent).toBe(true);
      expect(hit!.statusCode).toBeUndefined();
    }
  });

  it('has no redirect besides the renames', async () => {
    expect((await redirects()).map((r) => r.source).sort()).toEqual(
      Object.keys(INDONESIAN_RENAMES).map(toSource).sort(),
    );
  });

  it('puts /explore/all before /explore/:category, so the static page is not read as a Category', async () => {
    const sources = (await redirects()).map((r) => r.source);
    expect(sources.indexOf('/explore/all')).toBeLessThan(sources.indexOf('/explore/:category'));
  });

  it('never redirects a signed-in, auth, token or API path: those keep their URL', async () => {
    const kept =
      /^\/(?:donasi-saya|inbox|akun|admin|moderasi|api|login|register|lupa-password|reset-password|receipt|akad-wakaf|sertifikat|donasi|campaign\/create|volunteer-trip)(?:\/|$)/;
    for (const r of await redirects()) expect(r.source, r.source).not.toMatch(kept);
  });
});
