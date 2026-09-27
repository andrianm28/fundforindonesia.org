import { describe, it, expect, vi } from 'vitest';
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

import proxy from './proxy';

const withAuthOptions = (proxy as unknown as {
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
    it('lists exactly the six guarded prefixes, nothing more or less', async () => {
      const { config } = await import('./proxy');
      expect(config.matcher).toEqual([
        '/donasi-saya/:path*',
        '/inbox/:path*',
        '/akun/:path*',
        '/campaign/create/:path*',
        '/admin/:path*',
        '/moderasi/:path*',
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

    it('sends the turned-back anonymous request to /login', () => {
      expect(withAuthOptions.pages.signIn).toBe('/login');
    });

    it.each(['/', '/login', '/register', '/explore/all', '/campaign/abc-123', '/search', '/faq', '/zakat'])(
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

    it('sends someone with the ADMIN Role but no ADMIN assignment home', () => {
      expect(run('/admin', 'ADMIN', []).headers.get('location')).toBe('http://localhost:3000/');
    });

    it('sends someone whose token carries no assignments home', () => {
      expect(run('/admin/users', 'ADMIN').headers.get('location')).toBe('http://localhost:3000/');
    });

    it('does not let the VERIFIER assignment stand in for ADMIN', () => {
      expect(run('/admin', 'MODERATOR', ['VERIFIER']).headers.get('location')).toBe('http://localhost:3000/');
    });
  });

  describe('the /moderasi gate asks for the VERIFIER assignment (ADR 0005), not the Role', () => {
    it.each(['/moderasi', '/moderasi/campaigns', '/moderasi/campaigns/123'])(
      'lets someone holding the VERIFIER assignment, whatever their Role, into %s',
      (path) => {
        expect(run(path, 'DONOR', ['VERIFIER']).headers.get('location')).toBeNull();
      },
    );

    it('sends someone with the MODERATOR Role but no VERIFIER assignment home', () => {
      expect(run('/moderasi', 'MODERATOR', []).headers.get('location')).toBe('http://localhost:3000/');
    });

    it('sends someone whose token carries no assignments home', () => {
      expect(run('/moderasi/campaigns', 'MODERATOR').headers.get('location')).toBe('http://localhost:3000/');
    });

    it('does not let the ADMIN assignment stand in for VERIFIER', () => {
      expect(run('/moderasi', 'ADMIN', ['ADMIN']).headers.get('location')).toBe('http://localhost:3000/');
    });
  });
});
