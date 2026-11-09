import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';

/**
 * Mode pemeliharaan (PKS ticket 01, src/lib/operations.ts): while it is on,
 * every write route refuses with 503 unless the caller is an Admin; /admin,
 * /api/admin, the webhooks, health, login and the scheduled jobs keep working.
 * Reads are never refused here: the public pages show a banner instead.
 */

vi.mock('next-auth/middleware', () => ({
  withAuth: (middleware: object) => middleware,
}));

const holder = vi.hoisted(() => ({
  row: null as { key: string; value: unknown } | null,
  fail: false,
  hang: false,
  token: null as { assignments?: string[] } | null,
}));

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => holder.token) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    category: { findUnique: async () => ({ id: 'x' }) },
    siteSetting: {
      findUnique: async () => {
        if (holder.hang) return new Promise(() => {});
        if (holder.fail) throw new Error('db down');
        return holder.row;
      },
    },
  },
}));

import proxy, { config } from './proxy';

const run = (path: string, method = 'POST') =>
  (proxy as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest(`http://localhost:3000${path}`, { method }),
  );

function maintenance(on: boolean, message = '') {
  holder.row = {
    key: 'operations',
    value: { donationsOpen: true, maintenance: { on, message }, history: [] },
  };
}

beforeEach(() => {
  holder.row = null;
  holder.fail = false;
  holder.hang = false;
  holder.token = null;
});

describe('maintenance mode on write routes', () => {
  it.each(['/api/campaigns', '/api/donations', '/api/prayers', '/api/documents/upload', '/api/user/profile'])(
    'refuses a visitor\'s POST to %s with 503 and the Admin\'s message',
    async (path) => {
      maintenance(true, 'Kembali pukul 10.00 WIB.');

      const res = await run(path);

      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe('Kembali pukul 10.00 WIB.');
      expect(res.headers.get('retry-after')).toBeTruthy();
    },
  );

  it('uses a default message when the Admin wrote none', async () => {
    maintenance(true);
    expect((await (await run('/api/donations')).json()).error).toMatch(/pemeliharaan/i);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('refuses %s as well', async (method) => {
    maintenance(true);
    expect((await run('/api/campaigns/abc', method)).status).toBe(503);
  });

  it('refuses a signed-in user who is not an Admin, Verifier included', async () => {
    maintenance(true);
    holder.token = { assignments: ['VERIFIER'] };
    expect((await run('/api/campaigns')).status).toBe(503);
  });

  it('lets an Admin write', async () => {
    maintenance(true);
    holder.token = { assignments: ['ADMIN'] };
    expect((await run('/api/campaigns')).status).toBe(200);
  });

  it.each([
    '/api/admin/operations',
    '/api/admin/site-settings',
    '/api/webhooks/sumopod',
    '/api/health',
    '/api/health/deep',
    '/api/auth/callback/credentials',
    '/api/auth/signout',
    '/api/internal/jobs/run',
    '/api/client-error',
    '/api/user/consent',
  ])('keeps %s working for everyone', async (path) => {
    maintenance(true);
    expect((await run(path)).status).toBe(200);
  });

  it('does not lock a pending user out of the consent page while maintenance is on', async () => {
    maintenance(true);
    holder.token = { assignments: [] };
    // The consent POST is the only way out of /akun/persetujuan: it must pass.
    expect((await run('/api/user/consent', 'POST')).status).toBe(200);
    // Other writes by the same user stay refused.
    expect((await run('/api/user/profile', 'PATCH')).status).toBe(503);
    expect((await run('/api/user/consent-lain', 'POST')).status).toBe(503);
  });

  it('does not mistake a lookalike prefix for an exempt route', async () => {
    maintenance(true);
    expect((await run('/api/administrasi')).status).toBe(503);
    expect((await run('/api/webhooks-lain')).status).toBe(503);
  });

  it('never refuses a read', async () => {
    maintenance(true);
    expect((await run('/api/campaigns', 'GET')).status).toBe(200);
    expect((await run('/api/campaigns', 'HEAD')).status).toBe(200);
  });

  it('lets everything through while maintenance is off or was never set', async () => {
    expect((await run('/api/donations')).status).toBe(200);
    maintenance(false);
    expect((await run('/api/donations')).status).toBe(200);
  });

  it('lets the request through when the switch cannot be read, or the read hangs', async () => {
    maintenance(true);
    holder.fail = true;
    expect((await run('/api/donations')).status).toBe(200);
    holder.fail = false;
    holder.hang = true;
    expect((await run('/api/donations')).status).toBe(200);
  });

  it('keeps /api/auth/register and password reset open during maintenance (intent, see runbook insiden)', async () => {
    maintenance(true);
    for (const path of ['/api/auth/register', '/api/auth/password-reset', '/api/auth/password-reset/confirm']) {
      expect((await run(path)).status).toBe(200);
    }
  });

  describe('fail-open logging', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    beforeEach(() => warn.mockClear());

    it('logs a structured warning when the lookup throws', async () => {
      maintenance(true);
      holder.fail = true;
      expect((await run('/api/donations')).status).toBe(200);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
        event: 'maintenance_lookup_failed',
        reason: 'error',
        policy: 'open',
        error: 'Error',
      });
    });

    it('logs a structured warning when the lookup times out', async () => {
      vi.useFakeTimers();
      try {
        maintenance(true);
        holder.hang = true;
        const pending = run('/api/donations');
        await vi.advanceTimersByTimeAsync(1500);
        expect((await pending).status).toBe(200);
        expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ event: 'maintenance_lookup_failed', reason: 'timeout' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('stays quiet when the switch is read fine', async () => {
      maintenance(true);
      await run('/api/donations');
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('runs on the API routes only through the matcher', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: 'http://localhost:3000/api/donations' })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, url: 'http://localhost:3000/' })).toBe(false);
  });
});
