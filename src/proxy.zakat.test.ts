import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';

/**
 * The zakat module's public routes answer a literal HTTP 404 while the module
 * is OFF (PKS pemenuhan 19, ADR 0028). It is decided here, in the proxy, for
 * the same reason as an unknown Category: a notFound() inside the page comes
 * behind the root loading.tsx, after the document began streaming as 200.
 */

vi.mock('next-auth/middleware', () => ({
  withAuth: (middleware: object) => middleware,
}));

const holder = vi.hoisted(() => ({
  row: null as { key: string; value: unknown } | null,
  fail: false,
  hang: false,
}));

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

const get = (path: string) =>
  (proxy as unknown as (req: NextRequest) => Promise<Response>)(new NextRequest(`http://localhost:3000${path}`));

function zakat(enabled: boolean) {
  holder.row = {
    key: 'operations',
    value: {
      donationsOpen: true,
      maintenance: { on: false, message: '' },
      zakat: { enabled, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' },
      history: [],
    },
  };
}

beforeEach(() => {
  holder.row = null;
  holder.fail = false;
  holder.hang = false;
});

describe('the zakat routes while the module is OFF', () => {
  it.each(['/zakat', '/zakat/', '/zakat/kalkulator'])('answers %s with HTTP 404 when nothing was ever stored (the default)', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(404);
  });

  it('answers 404 when the switch is stored as off', async () => {
    zakat(false);
    expect((await get('/zakat')).status).toBe(404);
  });

  it('answers 404 when the setting cannot be read: the default is off', async () => {
    holder.fail = true;
    expect((await get('/zakat')).status).toBe(404);
  });

  it('answers 404 when the lookup hangs, instead of holding the request', async () => {
    holder.hang = true;
    expect((await get('/zakat')).status).toBe(404);
  });
});

describe('the zakat routes while the module is ON', () => {
  it('lets /zakat through to the page', async () => {
    zakat(true);
    const res = await get('/zakat');
    expect(res.status).toBe(200);
  });
});

describe('the matcher', () => {
  it.each(['/zakat', '/zakat/anything'])('covers %s', (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` })).toBe(true);
  });
});
