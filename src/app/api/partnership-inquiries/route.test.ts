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
  /** when set, the limiter's SQL statements throw this. */
  dbFailure: null as Error | null,
  deleteFailure: null as Error | null,
  programs: [{ id: 'program-1', title: 'Klinik Keliling Pesisir', slug: 'klinik-keliling-pesisir', sector: 'HEALTH' }],
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // consumeRateLimit's one atomic statement: bump the bucket, answer the count.
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      void strings;
      if (state.dbFailure) throw state.dbFailure;
      const key = `${values[0]}:${values[1]}`;
      const count = (state.buckets.get(key) ?? 0) + 1;
      state.buckets.set(key, count);
      return [{ count }];
    },
    $executeRaw: async () => {
      if (state.deleteFailure) throw state.deleteFailure;
      return 0;
    },
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
  state.dbFailure = null;
  state.deleteFailure = null;
  vi.stubEnv('RATE_LIMIT_SECRET', 'test-secret');
  vi.stubEnv('PARTNERSHIP_TEAM_EMAIL', 'kemitraan@contoh.test');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

    it('with TRUSTED_PROXY_HOPS=2, counts the entry two from the end and ignores a forged front', async () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
      let refused = false;
      for (let i = 0; i < 12; i++) {
        // client-sent forgery, the real client (added by the outer proxy), the outer proxy (added by the inner one)
        const res = await post(VALID, `10.0.0.${i}, 198.51.100.7, 192.0.2.50`);
        if (res.status === 429) refused = true;
      }
      expect(refused).toBe(true);
      // Same outer proxy, a different real client: its own bucket, not the proxy's.
      expect((await post(VALID, '10.0.0.1, 198.51.100.8, 192.0.2.50')).status).toBe(201);
    });

    it('answers a filled honeypot exactly like success, but writes nothing', async () => {
      const res = await post({ ...VALID, fax_ref: 'http://spam.example' });

      expect(res.status).toBe(201);
      expect(state.rows).toHaveLength(0);
      const body = JSON.stringify(await res.json());
      expect(body).not.toMatch(/fax_ref|website|honeypot|spam|bot/i);
    });

    it('treats a whitespace-only honeypot as empty, but a non-string value as filled', async () => {
      expect((await post({ ...VALID, fax_ref: '   ' })).status).toBe(201);
      expect(state.rows).toHaveLength(1);
      for (const value of [1, true, ['x'], { a: 1 }]) {
        const res = await post({ ...VALID, fax_ref: value });
        expect(res.status).toBe(201);
      }
      expect(state.rows).toHaveLength(1);
    });

    it('no longer treats the old `website` field as the honeypot', async () => {
      expect((await post({ ...VALID, website: 'https://pt-sinar.test' })).status).toBe(201);
      expect(state.rows).toHaveLength(1);
    });

    it('logs a honeypot hit as one structured line with no address, email or form content', async () => {
      const lines: string[] = [];
      vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
        lines.push(String(line));
      });

      await post({ ...VALID, fax_ref: 'http://spam.example' }, '203.0.113.9');

      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(entry.event).toBe('honeypot_triggered');
      expect(lines[0]).not.toMatch(/203\.0\.113|rina@|Sinar|spam\.example/);
    });

    it('fails open, logging without PII, when the secret is missing in production', async () => {
      const lines: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('RATE_LIMIT_SECRET', '');
      vi.stubEnv('NEXTAUTH_SECRET', '');

      const res = await post(VALID, '203.0.113.9');

      expect(res.status).toBe(201);
      expect(state.rows).toHaveLength(1);
      const entry = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((e) => e.event === 'rate_limit_unavailable');
      expect(entry).toBeDefined();
      expect(lines.join('\n')).not.toMatch(/203\.0\.113|rina@/);
    });

    it('fails open when the limiter database errors', async () => {
      const lines: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
      state.dbFailure = new Error('connection refused');

      const res = await post(VALID);

      expect(res.status).toBe(201);
      expect(state.rows).toHaveLength(1);
      expect(lines.join('\n')).toContain('rate_limit_unavailable');
    });

    it('does not fail the request when the best-effort cleanup DELETE throws', async () => {
      state.deleteFailure = new Error('deadlock');
      expect((await post(VALID)).status).toBe(201);
      expect(state.rows).toHaveLength(1);
    });

    it('counts the global ceiling only for requests that pass validation and the honeypot', async () => {
      await post({ ...VALID, contactEmail: 'bukan-alamat' });
      await post({ ...VALID, fax_ref: 'x' });
      await post({ ...VALID, programId: 'program-hilang' });
      await POST(new NextRequest(URL, { method: 'POST', body: 'nope' }));
      const globalKeys = [...state.buckets.keys()].filter((k) => k.startsWith('partnership-inquiry:all:'));
      expect(globalKeys).toHaveLength(0);

      await post(VALID);
      const counted = [...state.buckets.entries()].filter(([k]) => k.startsWith('partnership-inquiry:all:'));
      expect(counted).toHaveLength(1);
      expect(counted[0][1]).toBe(1);
    });

    it('refuses with 429 and logs one line when the global limit is reached, writing nothing', async () => {
      const lines: string[] = [];
      vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
      for (let i = 0; i < 300; i++) expect((await post(VALID, `10.${Math.floor(i / 250)}.${i % 250}.1`)).status).toBe(201);
      const written = state.rows.length;
      expect(written).toBe(300);

      const res = await post(VALID, '10.9.9.9');
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
      expect(state.rows).toHaveLength(written);
      const hits = lines.filter((l) => l.includes('rate_limit_global_reached'));
      expect(hits).toHaveLength(1);
      expect(hits[0]).not.toMatch(/10\.9\.9\.9/);
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
