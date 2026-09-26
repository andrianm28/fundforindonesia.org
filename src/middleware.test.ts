import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// withAuth only decodes the session cookie into req.nextauth.token before
// calling our function; stand in for that so the real routing logic runs.
vi.mock('next-auth/middleware', () => ({
  withAuth: (middleware: unknown) => middleware,
}));

import middleware from './middleware';

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
  return (middleware as unknown as (req: NextRequest) => Response)(requestAs(pathname, role, assignments));
}

describe('middleware', () => {
  it('sends a Donor on /campaign/create to /akun, where becoming a Fundraiser is explained', () => {
    const response = run('/campaign/create', 'DONOR');

    expect(response.headers.get('location')).toBe('http://localhost:3000/akun');
  });

  it('lets a Fundraiser through to /campaign/create', () => {
    const response = run('/campaign/create', 'CAMPAIGN_CREATOR');

    expect(response.headers.get('location')).toBeNull();
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
