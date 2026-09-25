import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// withAuth only decodes the session cookie into req.nextauth.token before
// calling our function; stand in for that so the real routing logic runs.
vi.mock('next-auth/middleware', () => ({
  withAuth: (middleware: unknown) => middleware,
}));

import middleware from './middleware';

type TokenRole = 'DONOR' | 'CAMPAIGN_CREATOR' | 'MODERATOR' | 'ADMIN';

function requestAs(pathname: string, role: TokenRole) {
  const req = new NextRequest(`http://localhost:3000${pathname}`) as NextRequest & {
    nextauth: { token: { role: TokenRole } };
  };
  req.nextauth = { token: { role } };
  return req;
}

function run(pathname: string, role: TokenRole) {
  return (middleware as unknown as (req: NextRequest) => Response)(requestAs(pathname, role));
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
});
