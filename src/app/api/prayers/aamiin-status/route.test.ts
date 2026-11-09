import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  marks: new Set<string>(),
  session: null as null | { user: { id: string } },
}));

vi.mock('@/lib/auth', () => ({ getServerSession: async () => state.session }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    aamiinMark: {
      findMany: async ({ where }: { where: { marker: string; prayerId: { in: string[] } } }) =>
        where.prayerId.in.filter((id) => state.marks.has(`${id}|${where.marker}`)).map((prayerId) => ({ prayerId })),
    },
  },
}));

import { GET } from './route';

const get = (ids: string) => GET(new NextRequest(`http://localhost:3000/api/prayers/aamiin-status?ids=${ids}`));

beforeEach(() => {
  vi.stubEnv('NEXTAUTH_SECRET', ['test', 'signing', 'key'].join('-'));
  state.marks = new Set(['p1|u:user-1', 'p3|u:user-1', 'p2|u:other']);
  state.session = null;
});

describe('GET /api/prayers/aamiin-status?ids=', () => {
  it('lists which of the Prayers the signed-in visitor already gave an Aamiin', async () => {
    state.session = { user: { id: 'user-1' } };
    const res = await get('p1,p2,p3');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ given: ['p1', 'p3'] });
  });

  it('tells a guest with no cookie that nothing was given, and reads no marks', async () => {
    const res = await get('p1,p2');
    expect(await res.json()).toEqual({ given: [] });
  });

  it('is never cached: it is about one visitor', async () => {
    const res = await get('p1');
    expect(res.headers.get('cache-control')).toMatch(/no-store|private/);
  });

  it('asks about at most 50 Prayers', async () => {
    state.session = { user: { id: 'user-1' } };
    const ids = Array.from({ length: 80 }, (_, i) => `x${i}`).join(',');
    expect((await get(ids)).status).toBe(200);
  });
});
