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
  /** hits per `${scope}:${subjectHash}` bucket; the stand-in for the shared table. */
  buckets: new Map<string, number>(),
  programs: [{ id: 'program-1', title: 'Klinik Keliling Pesisir', slug: 'klinik-keliling-pesisir', sector: 'HEALTH' }],
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // consumeRateLimit's one atomic statement: bump the bucket, answer the count.
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      void strings;
      const key = `${values[0]}:${values[1]}`;
      const count = (state.buckets.get(key) ?? 0) + 1;
      state.buckets.set(key, count);
      return [{ count }];
    },
    $executeRaw: async () => 0,
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

function post(body: unknown, ip = '203.0.113.9'): Promise<Response> {
  return POST(
    new NextRequest(URL, { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip } }),
  );
}

beforeEach(() => {
  state.rows = [];
  state.buckets = new Map();
  vi.stubEnv('RATE_LIMIT_SECRET', 'test-secret');
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

  describe('spam guard (csr-06b)', () => {
    it('refuses a client past its limit with a friendly 429, writing nothing and mailing no one', async () => {
      let refused: Response | undefined;
      for (let i = 0; i < 12 && !refused; i++) {
        const res = await post(VALID);
        if (res.status === 429) refused = res;
      }

      expect(refused).toBeDefined();
      expect(state.rows.length).toBeLessThan(12);
      const written = state.rows.length;
      const body = (await refused!.json()) as { error: string };
      expect(body.error).toMatch(/coba lagi/i);
      expect(refused!.headers.get('retry-after')).toMatch(/^\d+$/);
      await post(VALID);
      expect(state.rows).toHaveLength(written);
    });

    it('does not lock out a legitimate partner who fills the form twice', async () => {
      expect((await post(VALID)).status).toBe(201);
      expect((await post({ ...VALID, needs: 'Tambahan informasi untuk diskusi kami.' })).status).toBe(201);
      expect(state.rows).toHaveLength(2);
    });

    it('limits per client: another address is unaffected', async () => {
      for (let i = 0; i < 12; i++) await post(VALID, '198.51.100.1');
      expect((await post(VALID, '198.51.100.2')).status).toBe(201);
    });

    it('does not let a client dodge the limit by forging the front of X-Forwarded-For', async () => {
      let refused = false;
      for (let i = 0; i < 12; i++) {
        const res = await post(VALID, `10.0.0.${i}, 198.51.100.7`);
        if (res.status === 429) refused = true;
      }
      expect(refused).toBe(true);
    });

    it('answers a filled honeypot exactly like success, but writes nothing', async () => {
      const res = await post({ ...VALID, website: 'http://spam.example' });

      expect(res.status).toBe(201);
      expect(state.rows).toHaveLength(0);
      const body = JSON.stringify(await res.json());
      expect(body).not.toMatch(/website|honeypot|spam|bot/i);
    });

    it('never says whether a company or email was already recorded', async () => {
      await post(VALID);
      const again = await post(VALID);

      expect(again.status).toBe(201);
    });

    it('stores no raw address in the bucket key', async () => {
      await post(VALID, '203.0.113.9');

      for (const key of state.buckets.keys()) expect(key).not.toContain('203.0.113.9');
    });
  });
});
