import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';

// withAuth only decodes the session cookie into req.nextauth.token before
// calling our function; stand in for that so the real routing logic runs.
// The `authorized` callback and `pages` option passed alongside it are what
// actually turns an anonymous (no-token) request back, so stash them on the
// returned function rather than discarding them.
vi.mock('next-auth/middleware', () => ({
  withAuth: (
    middleware: object,
    options: { callbacks: { authorized: (args: { token: unknown }) => boolean }; pages: { signIn: string } },
  ) => Object.assign(middleware, { withAuthOptions: options }),
}));

const holder = vi.hoisted(() => ({ categories: new Set<string>(), fail: false }));

// The /explore/<category> answer reads the Category table; stand in for it.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    category: {
      findUnique: async ({ where }: { where: { slug: string } }) => {
        if (holder.fail) throw new Error('db down');
        return holder.categories.has(where.slug) ? { id: where.slug } : null;
      },
    },
  },
}));

import proxy, { authProxy } from './proxy';

const withAuthOptions = (authProxy as unknown as {
  withAuthOptions: { callbacks: { authorized: (args: { token: unknown }) => boolean }; pages: { signIn: string } };
}).withAuthOptions;

type TokenRole = 'DONOR' | 'CAMPAIGN_CREATOR' | 'MODERATOR' | 'ADMIN';
type TokenAssignment = 'ADMIN' | 'VERIFIER';

function requestAs(pathname: string, role: TokenRole, assignments?: TokenAssignment[]) {
  const req = new NextRequest(`http://localhost:3000${pathname}`) as NextRequest & {
    nextauth: { token: { role: TokenRole; assignments?: TokenAssignment[] } };
  };
  req.nextauth = { token: { role, assignments } };
  return req;
}

function run(pathname: string, role: TokenRole, assignments?: TokenAssignment[]) {
  return (proxy as unknown as (req: NextRequest) => Response)(requestAs(pathname, role, assignments));
}

/**
 * A signed-in user without the assignment gets the same 404 as a page that
 * does not exist, never a redirect that confirms the panel is there (owner
 * decision 2026-10-14, ticket 90: "yang lain 404").
 */
function expectNotFound(res: Response) {
  expect(res.status).toBe(404);
  expect(res.headers.get('location')).toBeNull();
}

describe('proxy', () => {
  it.each(['/campaign/create', '/campaign/create/step-2'])(
    'lets any signed-in user, with no Role or assignment, through to %s (FFI-04)',
    (path) => {
      expect(run(path, 'DONOR', []).headers.get('location')).toBeNull();
    },
  );

  it('still asks for sign-in on /campaign/create: it stays in the matcher and a token is required', async () => {
    const { config } = await import('./proxy');
    expect(config.matcher).toContain('/campaign/create/:path*');
  });

  describe('the matcher pins exactly the protected prefixes', () => {
    it('lists exactly the six guarded prefixes plus the one status-only /explore/:category entry', async () => {
      const { config } = await import('./proxy');
      expect(config.matcher).toEqual([
        '/donasi-saya/:path*',
        '/inbox/:path*',
        '/akun',
        '/akun/((?!verifikasi-email(?:/|$)).+)',
        '/campaign/create/:path*',
        '/admin/:path*',
        '/moderasi/:path*',
        // Not a guard: answers 404 for an unknown Category (see below).
        '/explore/:category',
      ]);
    });

    it.each([
      '/donasi-saya',
      '/donasi-saya/123',
      '/inbox',
      '/inbox/456',
      '/akun',
      '/akun/settings',
      '/campaign/create',
      '/campaign/create/step-2',
      '/admin',
      '/admin/users',
      '/moderasi',
      '/moderasi/campaigns',
    ])('an anonymous request to %s is turned back: the authorized callback requires a token', async (path) => {
      const { config } = await import('./proxy');
      expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` })).toBe(true);
      expect(withAuthOptions.callbacks.authorized({ token: undefined })).toBe(false);
    });

    it.each(['/akun/verifikasi-email', '/akun/verifikasi-email/'])(
      'never reaches the guard for %s: no login redirect means the token never lands in a callbackUrl',
      async (path) => {
        const { config } = await import('./proxy');
        expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}?token=secret` })).toBe(false);
      },
    );

    it.each(['/akun/verifikasi-email-lain', '/akun/pengaturan/verifikasi-email'])(
      'still guards the lookalike %s',
      async (path) => {
        const { config } = await import('./proxy');
        expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` })).toBe(true);
      },
    );

    it('sends the turned-back anonymous request to /login', () => {
      expect(withAuthOptions.pages.signIn).toBe('/login');
    });

    it.each(['/', '/login', '/register', '/explore/all/x', '/campaign/abc-123', '/search', '/faq', '/zakat'])(
      'a public path like %s never reaches the guard: the matcher does not cover it',
      async (path) => {
        const { config } = await import('./proxy');
        expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` })).toBe(false);
      },
    );
  });

  describe('the /admin gate asks for the ADMIN assignment (ADR 0005), not the Role', () => {
    it.each(['/admin', '/admin/users', '/admin/campaigns/123'])(
      'lets someone holding the ADMIN assignment, whatever their Role, into %s',
      (path) => {
        expect(run(path, 'DONOR', ['ADMIN']).headers.get('location')).toBeNull();
      },
    );

    it('answers someone with the ADMIN Role but no ADMIN assignment with a 404, not a redirect', () => {
      expectNotFound(run('/admin', 'ADMIN', []));
    });

    it('answers someone whose token carries no assignments with a 404', () => {
      expectNotFound(run('/admin/users', 'ADMIN'));
    });

    it('does not let the VERIFIER assignment stand in for ADMIN', () => {
      expectNotFound(run('/admin', 'MODERATOR', ['VERIFIER']));
    });
  });

  describe('the /moderasi gate asks for the VERIFIER assignment (ADR 0005), not the Role', () => {
    it.each(['/moderasi', '/moderasi/campaigns', '/moderasi/campaigns/123'])(
      'lets someone holding the VERIFIER assignment, whatever their Role, into %s',
      (path) => {
        expect(run(path, 'DONOR', ['VERIFIER']).headers.get('location')).toBeNull();
      },
    );

    it('answers someone with the MODERATOR Role but no VERIFIER assignment with a 404, not a redirect', () => {
      expectNotFound(run('/moderasi', 'MODERATOR', []));
    });

    it('answers someone whose token carries no assignments with a 404', () => {
      expectNotFound(run('/moderasi/campaigns', 'MODERATOR'));
    });

    it('does not let the ADMIN assignment stand in for VERIFIER', () => {
      expectNotFound(run('/moderasi', 'ADMIN', ['ADMIN']));
    });
  });

  describe('an unknown Category under /explore answers HTTP 404', () => {
    // notFound() in the page runs behind the root loading.tsx, after the
    // document has begun streaming as 200 (rilis-1-benda/96), so the status
    // is decided here, as for the panels above.
    const get = (path: string) =>
      (proxy as unknown as (req: NextRequest) => Promise<Response>)(new NextRequest(`http://localhost:3000${path}`));

    beforeEach(() => {
      holder.categories = new Set(['kesehatan']);
      holder.fail = false;
    });

    it.each(['/explore/zakat', '/explore/kategori-ngawur-xyz', '/explore/%E0%A4%A'])(
      'answers 404 for %s',
      async (path) => {
        const res = await get(path);
        expect(res.status).toBe(404);
      },
    );

    it('lets a Category that exists through to the page', async () => {
      const res = await get('/explore/kesehatan');
      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-next')).toBe('1');
    });

    it('never asks for sign-in: it is a public path', async () => {
      const res = await get('/explore/zakat');
      expect(res.headers.get('location')).toBeNull();
    });

    it('leaves /explore/all, a real page of its own, alone', async () => {
      holder.fail = true;
      const res = await get('/explore/all');
      expect(res.headers.get('x-middleware-next')).toBe('1');
    });

    it('falls through to the page when the lookup fails, which then renders its own 404 or error', async () => {
      holder.fail = true;
      const res = await get('/explore/kesehatan');
      expect(res.headers.get('x-middleware-next')).toBe('1');
    });
  });
});
