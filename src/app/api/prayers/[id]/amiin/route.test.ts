import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Aamiin (PKS pemenuhan 15, Pasal 3.7(5)): one per (Prayer, marker). The fake
 * below keeps the Prayers and the marks in memory, with the unique key, the
 * guarded counter and the rollback the real tables and transaction have, so
 * the tests read behaviour, not calls.
 */
const state = vi.hoisted(() => ({
  prayers: new Map<string, { id: string; amiinCount: number; hidden: boolean; deletedAt: Date | null }>(),
  marks: new Set<string>(),
  session: null as null | { user: { id: string } },
  /** Runs between the dedupe insert and the counter update: a moderator racing the transaction. */
  betweenInsertAndIncrement: null as null | (() => void),
  /** Thrown by the mark insert: the Prayer hard-deleted after the read (FK violation). */
  insertError: null as null | Error,
  /** What the per-address limiter answers. */
  limiter: { allowed: true, count: 1, retryAfterSeconds: 60 },
}));

vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn(async () => state.limiter) }));

vi.mock('@/lib/auth', () => ({ getServerSession: async () => state.session }));

vi.mock('@/lib/prisma', () => {
  const db = {
    prayer: {
      findUnique: async ({ where }: { where: { id: string } }) => state.prayers.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ ...state.prayers.get(where.id)! }),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; hidden: boolean; deletedAt: null };
        data: { amiinCount: { increment: number } };
      }) => {
        state.betweenInsertAndIncrement?.();
        const p = state.prayers.get(where.id);
        if (!p || p.hidden !== where.hidden || p.deletedAt !== where.deletedAt) return { count: 0 };
        p.amiinCount += data.amiinCount.increment;
        return { count: 1 };
      },
    },
    aamiinMark: {
      createMany: async ({ data }: { data: Array<{ prayerId: string; marker: string }> }) => {
        if (state.insertError) throw state.insertError;
        let count = 0;
        for (const d of data) {
          const key = `${d.prayerId}|${d.marker}`;
          if (!state.marks.has(key)) {
            state.marks.add(key);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
  return {
    prisma: {
      ...db,
      $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => {
        const marks = new Set(state.marks);
        const counts = new Map([...state.prayers].map(([id, p]) => [id, p.amiinCount]));
        try {
          return await fn(db);
        } catch (e) {
          state.marks = marks;
          for (const [id, n] of counts) state.prayers.get(id)!.amiinCount = n;
          throw e;
        }
      },
    },
  };
});

import { POST } from './route';

const secret = ['test', 'signing', 'key'].join('-');

function request(id: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/prayers/${id}/amiin`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });
}

const call = (id: string, cookie?: string) => POST(request(id, cookie), { params: Promise.resolve({ id }) });

/** The `name=value` of the cookie the response sets, to send back as the visitor's browser would. */
function cookieFrom(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

beforeEach(() => {
  vi.stubEnv('NEXTAUTH_SECRET', secret);
  state.prayers = new Map([['p1', { id: 'p1', amiinCount: 5, hidden: false, deletedAt: null }]]);
  state.marks = new Set();
  state.session = null;
  state.betweenInsertAndIncrement = null;
  state.insertError = null;
  state.limiter = { allowed: true, count: 1, retryAfterSeconds: 60 };
});

describe('POST /api/prayers/[id]/amiin', () => {
  it('counts a first Aamiin from a guest and hands them a signed anonymous id', async () => {
    const res = await call('p1');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'p1', amiinCount: 6, alreadyAamiin: false });
    expect(res.headers.get('set-cookie')).toMatch(/ffi_aamiin=/);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  });

  it('a second Aamiin from the same guest adds nothing and says it was already given', async () => {
    const first = await call('p1');
    const second = await call('p1', cookieFrom(first));

    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ amiinCount: 6, alreadyAamiin: true });
    expect(state.prayers.get('p1')!.amiinCount).toBe(6);
  });

  it('two different guests each count once', async () => {
    await call('p1');
    await call('p1');
    expect(state.prayers.get('p1')!.amiinCount).toBe(7);
  });

  it('a tampered cookie is not trusted: it is treated as a new guest', async () => {
    const first = await call('p1');
    const tampered = cookieFrom(first).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    const res = await call('p1', tampered);

    expect((await res.json()).alreadyAamiin).toBe(false);
    expect(state.prayers.get('p1')!.amiinCount).toBe(7);
  });

  it('a signed-in visitor counts once, needs no anonymous cookie, and is not counted twice by a cookie', async () => {
    state.session = { user: { id: 'user-1' } };
    await call('p1');
    const again = await call('p1');

    expect((await again.json()).alreadyAamiin).toBe(true);
    expect(state.prayers.get('p1')!.amiinCount).toBe(6);
    expect(again.headers.get('set-cookie')).toBeNull();
  });

  it('a guest Aamiin and a user Aamiin are different markers', async () => {
    const guest = await call('p1');
    state.session = { user: { id: 'user-1' } };
    await call('p1', cookieFrom(guest));
    expect(state.prayers.get('p1')!.amiinCount).toBe(7);
  });

  it('answers 404 when the Prayer does not exist', async () => {
    const res = await call('nope');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Doa tidak ditemukan');
  });

  it.each([
    ['hidden', { hidden: true, deletedAt: null }],
    ['deleted', { hidden: false, deletedAt: new Date('2026-11-11T00:00:00Z') }],
  ])('answers 404 for a %s Prayer and records nothing (PKS 3.7c)', async (_label, moderation) => {
    state.prayers.set('p1', { id: 'p1', amiinCount: 5, ...moderation });
    const res = await call('p1');

    expect(res.status).toBe(404);
    expect(state.marks.size).toBe(0);
    expect(state.prayers.get('p1')!.amiinCount).toBe(5);
  });

  it('a Prayer hidden between the check and the increment rolls the whole Aamiin back and answers 404', async () => {
    state.betweenInsertAndIncrement = () => {
      state.prayers.get('p1')!.hidden = true;
    };
    const res = await call('p1');

    expect(res.status).toBe(404);
    expect(state.marks.size).toBe(0);
    expect(state.prayers.get('p1')!.amiinCount).toBe(5);
  });

  it('a Prayer hard-deleted between the read and the insert (FK violation, P2003) answers 404, not 500', async () => {
    state.insertError = Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' });
    const res = await call('p1');

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Doa tidak ditemukan');
  });

  it('answers 429 with Retry-After over the per-address limit and counts nothing', async () => {
    state.limiter = { allowed: false, count: 99, retryAfterSeconds: 42 };
    const res = await call('p1');

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect((await res.json()).error).toMatch(/terlalu banyak/i);
    expect(state.marks.size).toBe(0);
    expect(state.prayers.get('p1')!.amiinCount).toBe(5);
  });

  it('counts the attempt per client address, scope amiin', async () => {
    const { consumeRateLimit } = await import('@/lib/rate-limit');
    const req = new NextRequest('http://localhost:3000/api/prayers/p1/amiin', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    await POST(req, { params: Promise.resolve({ id: 'p1' }) });

    expect(consumeRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: 'prayer-amiin', subject: '203.0.113.9' }),
    );
  });

  it('serves the Aamiin when the limiter itself is down (fail open)', async () => {
    const { consumeRateLimit } = await import('@/lib/rate-limit');
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    (consumeRateLimit as unknown as Mock).mockRejectedValueOnce(new Error('limiter down'));
    const res = await call('p1');

    expect(res.status).toBe(200);
    expect(state.prayers.get('p1')!.amiinCount).toBe(6);
  });

  it('answers 500 when the database fails', async () => {
    state.prayers.get = () => {
      throw new Error('DB error');
    };
    const res = await call('p1');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Gagal menambahkan amiin');
  });
});
