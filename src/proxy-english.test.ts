import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';

// A stand-in for withAuth that keeps its one real duty: no token, no entry
// (a redirect to the sign-in page). The token is read off req.nextauth.
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
const NOT_FOUND = 'http://localhost:3000/_not-found';

beforeEach(() => vi.stubEnv('NEXTAUTH_SECRET', 'test-secret'));
afterEach(() => vi.unstubAllEnvs());

describe('English gate (I18N_ENGLISH_ENABLED): off by default', () => {
  it.each(['/en', '/en/', '/en/about', '/en/campaign/abc', '/en/akun', '/id/about'])(
    'answers 404 for %s while the variable is unset',
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(rewriteOf(res)).toBe(NOT_FOUND);
    },
  );

  it.each(['', 'TRUE', '1', 'true '])('treats %j as off', async (value) => {
    vi.stubEnv('I18N_ENGLISH_ENABLED', value);
    expect((await get('/en/about')).status).toBe(404);
  });

  it('does not ask for sign-in on a gated English path while off: it is simply not there', async () => {
    const res = await get('/en/akun');
    expect(res.status).toBe(404);
    expect(locationOf(res)).toBeNull();
  });
});

describe('English pages with I18N_ENGLISH_ENABLED=true', () => {
  const on = () => vi.stubEnv('I18N_ENGLISH_ENABLED', 'true');

  it('serves /en/<path> from the page at <path>, tagging the request as English', async () => {
    on();
    const res = await get('/en/campaign/abc-123');
    expect(res.status).toBe(200);
    expect(rewriteOf(res)).toBe('http://localhost:3000/campaign/abc-123');
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-next-intl-locale');
    expect(res.headers.get('x-middleware-request-x-next-intl-locale')).toBe('en');
  });

  it('serves /en as the home page and keeps the query string', async () => {
    on();
    expect(rewriteOf(await get('/en'))).toBe('http://localhost:3000/');
    expect(rewriteOf(await get('/en?ref=x'))).toBe('http://localhost:3000/?ref=x');
  });

  it('maps an English spelling to the folder of the page and redirects the Indonesian spelling under /en', async () => {
    on();
    expect(rewriteOf(await get('/en/forgot-password'))).toBe('http://localhost:3000/lupa-password');
    expect(rewriteOf(await get('/en/certificate/AB12'))).toBe('http://localhost:3000/sertifikat/AB12');
    const res = await get('/en/lupa-password');
    expect(res.status).toBe(307);
    expect(locationOf(res)).toBe('http://localhost:3000/en/forgot-password');
  });

  it('gives an Indonesian page one URL: /id/... redirects to the unprefixed form', async () => {
    on();
    const res = await get('/id/tentang-kami?x=1');
    expect(res.status).toBe(307);
    expect(locationOf(res)).toBe('http://localhost:3000/tentang-kami?x=1');
  });

  it('sets no language cookie and no Link header: the URL alone decides', async () => {
    on();
    const res = await get('/en/about');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('link')).toBeNull();
  });

  it.each(['/en/admin', '/en/admin/users', '/en/moderasi', '/en/moderasi/campaigns', '/en/ADMIN', '/en/Moderasi/x'])(
    'serves no panel under %s, even to someone holding the assignment',
    async (path) => {
      on();
      const res = await get(path, { role: 'ADMIN', assignments: ['ADMIN', 'VERIFIER'] });
      expect(res.status).toBe(404);
      expect(rewriteOf(res)).toBe(NOT_FOUND);
    },
  );

  it.each([
    '/en/admin%00', '/en/admin%20', '/en/admin%0a', '/en/admin%09', '/en/moderasi%00', '/en/moderasi%0d',
    '/en/akun%00', '/en/inbox%20', '/en/donasi-saya%00', '/en/campaign/create%00', '/en/admin%E2%80%8B',
    '/en/admin/%00', '/en/%00admin',
  ])('answers 404 for %s: control characters and whitespace never reach a page', async (path) => {
    on();
    const res = await get(path, { role: 'ADMIN', assignments: ['ADMIN', 'VERIFIER'] });
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toBe(NOT_FOUND);
  });

  it.each([
    '/en/api/x', '/en/api', '/en/_next/x', '/en/_next/static/a.js', '/en/uploads/f', '/en/robots.txt',
    '/id/api/x', '/id/_next/x', '/id/uploads/f',
  ])('answers 404 for %s: not a page', async (path) => {
    on();
    const res = await get(path);
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toBe(NOT_FOUND);
  });

  it('signs the rewritten request so the page can tell the proxy tagged it', async () => {
    on();
    const res = await get('/en/about');
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-ffi-locale-sig');
    expect(res.headers.get('x-middleware-request-x-ffi-locale-sig')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers 404 for a path under an upper-case prefix instead of guessing', async () => {
    on();
    expect((await get('/EN/about')).status).toBe(404);
  });

  it('survives a malformed escape without a server error', async () => {
    on();
    const res = await get('/en/%E0%A4%A');
    expect(res.status).not.toBe(500);
  });
});

describe('the sign-in gate fails closed under /en', () => {
  const on = () => vi.stubEnv('I18N_ENGLISH_ENABLED', 'true');
  const GATED = [
    '/en/akun',
    '/en/akun/pengaturan',
    '/en/donasi-saya',
    '/en/donasi-saya/1',
    '/en/inbox',
    '/en/inbox/2',
    '/en/campaign/create',
    '/en/campaign/create/step-2',
  ];

  it.each(GATED)('turns an anonymous request to %s back to /login', async (path) => {
    on();
    const res = await get(path, null);
    expect(res.status).toBe(307);
    expect(new URL(locationOf(res)!).pathname).toBe('/login');
  });

  it.each(GATED)('lets a signed-in user through to the page behind %s', async (path) => {
    on();
    const res = await get(path, { role: 'DONOR', assignments: [] });
    expect(res.status).toBe(200);
    expect(rewriteOf(res)).toBe(`http://localhost:3000${path.slice(3)}`);
    expect(res.headers.get('x-middleware-request-x-next-intl-locale')).toBe('en');
  });

  it('keeps /akun/verifikasi-email open in English, as in Indonesian: its token must not reach a callbackUrl', async () => {
    on();
    const res = await get('/en/akun/verifikasi-email?token=secret', null);
    expect(res.status).toBe(200);
    expect(locationOf(res)).toBeNull();
    expect(rewriteOf(res)).toBe('http://localhost:3000/akun/verifikasi-email?token=secret');
  });

  it('still guards the lookalike of the verification page', async () => {
    on();
    const res = await get('/en/akun/verifikasi-email-lain', null);
    expect(res.status).toBe(307);
  });

  it('does not let a trailing slash or double slash slip past the gate', async () => {
    on();
    for (const path of ['/en/akun/', '/en//akun', '/en/inbox/']) {
      const res = await get(path, null);
      expect(res.status, path).not.toBe(200);
    }
  });

  it('leaves a public English page open', async () => {
    on();
    expect((await get('/en/faq', null)).status).toBe(200);
  });
});

describe('the matcher', () => {
  const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` });

  it.each(['/en', '/en/', '/en/about', '/en/akun/x', '/id', '/id/about'])('covers %s', (path) => {
    expect(matches(path)).toBe(true);
  });

  it.each([
    '/',
    '/about',
    '/campaign/abc',
    '/login',
    '/english',
    '/enterprise',
    '/identity',
    '/api/health',
    '/_next/static/x.js',
  ])('leaves Indonesian and unrelated path %s alone', (path) => {
    expect(matches(path)).toBe(false);
  });
});
