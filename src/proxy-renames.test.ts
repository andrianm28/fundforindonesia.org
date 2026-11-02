import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import nextConfig from '../next.config.mjs';
import { INDONESIAN_RENAMES } from '@/i18n/pathnames';

// Q1 renames (ADR 0024): the renames and their 308s are Indonesian URL changes
// and ship independent of the English gate. None of them touches a signed-in,
// auth, token or API path, so the gate has to hold exactly as before under the
// old and the new spelling alike (there is no gated path that moved).

vi.mock('next-auth/middleware', () => ({
  withAuth:
    (
      middleware: (req: unknown, ev: unknown) => Response,
      options: { callbacks: { authorized: (args: { token: unknown }) => boolean }; pages: { signIn: string } },
    ) =>
    (req: NextRequest & { nextauth?: { token: unknown } }, ev: unknown) => {
      const token = req.nextauth?.token;
      if (!options.callbacks.authorized({ token })) {
        const url = new URL(options.pages.signIn, req.url);
        url.searchParams.set('callbackUrl', req.url);
        return NextResponse.redirect(url);
      }
      req.nextauth = { token };
      return middleware(req, ev);
    },
}));
vi.mock('@/lib/prisma', () => ({ prisma: { category: { findUnique: async () => ({ id: 'x' }) } } }));

import proxy, { config } from './proxy';

type Token = { role: string; assignments?: string[] } | null;
async function get(path: string, token: Token = null) {
  const req = new NextRequest(`http://localhost:3000${path}`) as NextRequest & { nextauth: { token: Token } };
  req.nextauth = { token };
  return (await (proxy as unknown as (r: NextRequest, e: unknown) => Promise<Response> | Response)(req, {})) as Response;
}
const rewriteOf = (res: Response) => res.headers.get('x-middleware-rewrite');
const locationOf = (res: Response) => res.headers.get('location');
const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` });

const GATED = ['/akun', '/akun/pengaturan', '/donasi-saya', '/donasi-saya/1', '/inbox', '/inbox/2', '/campaign/create', '/campaign/create/step-2'];
type Redirect = { source: string; destination: string; permanent: boolean };
const redirects = () => (nextConfig as unknown as { redirects: () => Promise<Redirect[]> }).redirects();

beforeEach(() => vi.stubEnv('NEXTAUTH_SECRET', 'test-secret'));
afterEach(() => vi.unstubAllEnvs());

describe('the gated and auth paths did not move', () => {
  it('none of the renamed pages is a gated path, so no gated path needs a 308', async () => {
    const gated = /^\/(?:donasi-saya|inbox|campaign\/create|akun|admin|moderasi|login|register|lupa-password|reset-password)(?:\/|$)/;
    for (const [old, renamed] of [...Object.entries(INDONESIAN_RENAMES)]) {
      expect(old, old).not.toMatch(gated);
      expect(renamed, renamed).not.toMatch(gated);
    }
    const sources = (await redirects()).map((r) => r.source);
    for (const path of GATED) expect(sources.some((s) => s === path || path.startsWith(`${s}/`)), path).toBe(false);
  });

  it.each(GATED)('still guards %s in the matcher', (path) => {
    expect(matches(path)).toBe(true);
  });

  it.each(GATED)('turns an anonymous request to %s back to /login, English gate open or closed', async (path) => {
    for (const gate of ['', 'true']) {
      vi.stubEnv('I18N_ENGLISH_ENABLED', gate);
      const res = await get(path, null);
      expect(res.status, path).toBe(307);
      expect(new URL(locationOf(res)!).pathname).toBe('/login');
    }
  });

  it.each(GATED.map((p) => `/en${p}`))('still guards %s under /en', async (path) => {
    vi.stubEnv('I18N_ENGLISH_ENABLED', 'true');
    const res = await get(path, null);
    expect(res.status).toBe(307);
    expect(new URL(locationOf(res)!).pathname).toBe('/login');
  });
});

describe('the new Indonesian paths are public pages', () => {
  it.each(['/cari', '/tentang-kami', '/kontak', '/karir', '/media', '/bantuan', '/syarat-dan-ketentuan', '/kebijakan-privasi', '/campaign/abc/donasi'])(
    '%s is outside the matcher: no sign-in, no proxy',
    (path) => {
      expect(matches(path)).toBe(false);
    },
  );

  it.each(['/jelajah/semua', '/jelajah/kesehatan'])('%s is in the matcher only for the Category status check, and never asks for sign-in', async (path) => {
    expect(matches(path)).toBe(true);
    const res = await get(path, null);
    expect(res.status).toBe(200);
    expect(locationOf(res)).toBeNull();
  });
});

describe('English spellings reach the renamed pages (gate open)', () => {
  const on = () => vi.stubEnv('I18N_ENGLISH_ENABLED', 'true');

  it.each([
    ['/en/about', '/tentang-kami'],
    ['/en/explore/all', '/jelajah/semua'],
    ['/en/explore/kesehatan', '/jelajah/kesehatan'],
    ['/en/search?q=air', '/cari?q=air'],
    ['/en/campaign/abc/donate', '/campaign/abc/donasi'],
    ['/en/privacy', '/kebijakan-privasi'],
  ])('rewrites %s to the page at %s', async (path, page) => {
    on();
    const res = await get(path, null);
    expect(res.status).toBe(200);
    expect(rewriteOf(res)).toBe(`http://localhost:3000${page}`);
  });

  it('sends the Indonesian spelling under /en to the English one', async () => {
    on();
    const res = await get('/en/tentang-kami', null);
    expect(locationOf(res)).toBe('http://localhost:3000/en/about');
  });

  it('leaves the 308 for the old Indonesian URL to next.config: the proxy never sees /about', () => {
    expect(matches('/about')).toBe(false);
    expect(matches('/explore/all')).toBe(false);
  });
});
