import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/partnership-inquiries through the real handler and the real module,
 * with the database stood in. The rules are the module's
 * (src/lib/partnership-inquiries.test.ts); this file proves a company can
 * submit one without an account, that the body's shape is checked before
 * anything is written, and that the partnership team's address comes from
 * configuration rather than from the request.
 */
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  programs: [{ id: 'program-1', title: 'Klinik Keliling Pesisir', slug: 'klinik-keliling-pesisir', sector: 'HEALTH' }],
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    program: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        const row = state.programs.find((p) => p.id === where.id);
        return row ? { ...row } : null;
      },
    },
    partnershipInquiry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `inquiry-${state.rows.length + 1}`, contactPhone: null, ...data };
        state.rows.push(row);
        return { ...row };
      },
    },
  },
}));

import { POST } from './route';

const URL = 'http://localhost:3000/api/partnership-inquiries';

const VALID = {
  programId: 'program-1',
  companyName: 'PT Sinar Abadi',
  contactName: 'Rina Wijaya',
  contactEmail: 'rina@sinarabadi.test',
  contactPhone: '+62 812 3456 7890',
  needs: 'Kami ingin mendanai logistic dan mobilitas tim kesehatan untuk 12 bulan.',
};

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

beforeEach(() => {
  state.rows = [];
  vi.stubEnv('PARTNERSHIP_TEAM_EMAIL', 'kemitraan@contoh.test');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/partnership-inquiries', () => {
  it('accepts an Inquiry from a company with no account, answering 201', async () => {
    const res = await post(VALID);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      inquiry: expect.objectContaining({
        programId: 'program-1',
        companyName: 'PT Sinar Abadi',
        status: 'NOT_YET_FOLLOWED_UP',
      }),
    });
    expect(state.rows).toHaveLength(1);
  });

  it('answers 404 for a Program that does not exist, writing nothing', async () => {
    const res = await post({ ...VALID, programId: 'program-hilang' });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Program yang ditanyakan tidak ditemukan.');
    expect(state.rows).toHaveLength(0);
  });

  it('answers 400 with the reason for an invalid Inquiry, writing nothing', async () => {
    const res = await post({ ...VALID, contactEmail: 'bukan-alamat' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Email narahubung tidak valid.');
    expect(state.rows).toHaveLength(0);
  });

  it('answers 400 for a body that is not a JSON object', async () => {
    for (const body of ['nope', '"only a string"', '[1, 2]', 'null']) {
      const res = await POST(new NextRequest(URL, { method: 'POST', body }));

      expect(res.status).toBe(400);
    }
    expect(state.rows).toHaveLength(0);
  });

  it('ignores a status the company tried to set for itself', async () => {
    const res = await post({ ...VALID, status: 'DONE' });

    expect(res.status).toBe(201);
    expect((await res.json()).inquiry.status).toBe('NOT_YET_FOLLOWED_UP');
    expect(state.rows[0].status).toBe('NOT_YET_FOLLOWED_UP');
  });

  it('does not let the request choose where the notification goes', async () => {
    const res = await post({ ...VALID, to: 'penyerang@contoh.test', partnershipTeamEmail: 'penyerang@contoh.test' });

    expect(res.status).toBe(201);
    expect(res.headers.get('x-partnership-team')).toBeNull();
    expect(state.rows[0]).not.toHaveProperty('to');
  });

  it('still accepts the Inquiry when the notification cannot go out, saying so out loud', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    vi.stubEnv('PARTNERSHIP_TEAM_EMAIL', undefined);
    vi.stubEnv('NODE_ENV', 'production');

    const res = await post(VALID);

    expect(res.status).toBe(201);
    expect(state.rows).toHaveLength(1);
    expect(lines.join('\n')).toContain('mail_not_configured');
  });
});
