import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/programs through the real handler and the real program module,
 * with the session and the database stood in. The rules are the module's
 * (src/lib/programs.test.ts); this file proves the ADMIN gate and that
 * requests reach the module.
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
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.rows.some((r) => r.slug === data.slug)) {
          throw new Error('Unique constraint failed on Program.slug');
        }
        const row = { id: `program-${state.rows.length + 1}`, ...data };
        state.rows.push(row);
        return { ...row };
      },
    },
  },
}));

import { POST } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const URL = 'http://localhost:3000/api/programs';

const VALID = {
  title: 'Klinik Keliling Pesisir',
  sector: 'HEALTH',
  problem: 'Akses layanan kesehatan dasar masih jauh.',
  beneficiaries: '1.000 warga pesisir.',
  location: 'Pesisir Utara',
  activities: 'Pemeriksaan rutin dan rujukan.',
  budget: 500000000,
  timeline: 'Jan–Des 2027',
};

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/programs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows = [];
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  it('creates a Program as the acting Admin, answering 201', async () => {
    const res = await post(VALID);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      program: expect.objectContaining({ title: 'Klinik Keliling Pesisir', slug: 'klinik-keliling-pesisir' }),
    });
    expect(state.rows).toHaveLength(1);
  });

  it('answers 400 with the reason for an invalid Program, writing nothing', async () => {
    const res = await post({ ...VALID, sector: 'HEALTHCARE' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Sektor Program tidak dikenal.');
    expect(state.rows).toHaveLength(0);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const res = await POST(new NextRequest(URL, { method: 'POST', body: 'nope' }));

    expect(res.status).toBe(400);
    expect(state.rows).toHaveLength(0);
  });

  it.each([
    ['nobody signed in', null, 401],
    ['a Verifier without the ADMIN assignment', { user: { id: 'verifier-1', assignments: ['VERIFIER'] } }, 403],
    ['a Fundraiser', { user: { id: 'creator-1', assignments: [] } }, 403],
  ])('refuses %s, writing nothing', async (_name, session, status) => {
    mockSession.mockResolvedValue(session);

    expect((await post(VALID)).status).toBe(status);
    expect(state.rows).toHaveLength(0);
  });
});
