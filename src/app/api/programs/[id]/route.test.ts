import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PATCH /api/programs/[id] through the real handler and the real program
 * module, with the session and the database stood in. The rules are the
 * module's (src/lib/programs.test.ts); this file proves the ADMIN gate and
 * that requests reach the module.
 */
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    program: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        const row = state.rows.find((r) =>
          Object.entries(where).every(([key, value]) => r[key] === value),
        );
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.rows.find((r) => r.id === where.id);
        if (!row) throw new Error('No Program found');
        Object.assign(row, data);
        return { ...row };
      },
    },
  },
}));

import { PATCH } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const URL = 'http://localhost:3000/api/programs/program-1';

function patch(id: string, body: unknown): Promise<Response> {
  return PATCH(new NextRequest(URL, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

describe('PATCH /api/programs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows = [
      {
        id: 'program-1',
        slug: 'klinik-keliling',
        title: 'Klinik Keliling',
        sector: 'HEALTH',
        reportedAmount: 0,
      },
    ];
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  it('edits the Program as the acting Admin', async () => {
    const res = await patch('program-1', { title: 'Klinik Keliling Pesisir', reportedAmount: 10000000 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      program: expect.objectContaining({ title: 'Klinik Keliling Pesisir', reportedAmount: 10000000 }),
    });
    expect(state.rows[0]).toMatchObject({ title: 'Klinik Keliling Pesisir', reportedAmount: 10000000 });
  });

  it('answers 404 for an unknown Program', async () => {
    const res = await patch('program-99', { title: 'Baru' });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Program tidak ditemukan.');
  });

  it('answers 400 with the reason for an invalid change, writing nothing', async () => {
    const res = await patch('program-1', { budget: -5 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Anggaran Program tidak boleh negatif.');
    expect(state.rows[0]).not.toHaveProperty('budget');
  });

  it('answers 400 for a body that is not JSON', async () => {
    const res = await PATCH(new NextRequest(URL, { method: 'PATCH', body: 'nope' }), {
      params: Promise.resolve({ id: 'program-1' }),
    });

    expect(res.status).toBe(400);
  });

  it.each([
    ['nobody signed in', null, 401],
    ['a Verifier without the ADMIN assignment', { user: { id: 'verifier-1', assignments: ['VERIFIER'] } }, 403],
    ['a Fundraiser', { user: { id: 'creator-1', assignments: [] } }, 403],
  ])('refuses %s, writing nothing', async (_name, session, status) => {
    mockSession.mockResolvedValue(session);

    expect((await patch('program-1', { title: 'Baru' })).status).toBe(status);
    expect(state.rows[0].title).toBe('Klinik Keliling');
  });
});
