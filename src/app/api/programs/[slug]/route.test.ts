import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { makeProgramDb, programRow, type ProgramRow } from '../../../../../tests/support/in-memory-program-db';

/**
 * /api/programs/[slug] (tickets csr-01 and csr-04). The segment is a slug, as
 * it is for a Campaign: PATCH is an Admin edit, and GET is the public
 * Program detail a CSR team reads before deciding to talk to us. The rules the
 * edit obeys are the module's (src/lib/programs.test.ts); this file proves the
 * ADMIN gate, the 404, and what a visitor is shown.
 *
 * A Program never takes money online (ADR 0002), so the public answer is the
 * catalog and nothing from the ledger: the detail test pins the exact key set
 * rather than scanning for a word.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../../tests/support/in-memory-program-db').makeProgramDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key: string) => (holder.db.prisma as Record<string, unknown>)[key] }),
}));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));

import { GET, PATCH } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const URL = 'http://localhost:3000/api/programs/klinik-keliling';

function row(overrides: Partial<ProgramRow> = {}): ProgramRow {
  return programRow({ slug: 'klinik-keliling', title: 'Klinik Keliling', ...overrides });
}

function get(slug: string): Promise<Response> {
  return GET(new NextRequest(`http://localhost:3000/api/programs/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

function patch(slug: string, body: unknown): Promise<Response> {
  return PATCH(new NextRequest(URL, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holder.db = makeProgramDb({ programs: [row()] });
  mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
});

describe('GET /api/programs/[slug]', () => {
  it('answers a visitor with every field of the Program, and needs no session', async () => {
    mockSession.mockResolvedValue(null);

    const res = await get('klinik-keliling');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      program: {
        // The id a Partnership Inquiry names, and the only internal handle the
        // public payload carries.
        id: 'program-1',
        slug: 'klinik-keliling',
        title: 'Klinik Keliling',
        sector: 'HEALTH',
        problem: 'Akses layanan kesehatan dasar di pesisir masih jauh.',
        beneficiaries: '1.000 warga pesisir di tiga kecamatan.',
        location: 'Pesisir Utara, Jawa Barat',
        activities: 'Pemeriksaan rutin, rujukan, dan pendampingan.',
        budget: 500000000,
        timeline: 'Jan–Des 2027',
        kpis: ['1.000 warga terlayani', 'Rujukan tepat waktu 90%'],
        documentation: ['https://contoh.test/rencana.pdf'],
        impactReport: 'Quarter pertama: 240 pemeriksaan.',
      },
    });
  });

  it('answers 404 for a slug no Program has', async () => {
    const res = await get('tidak-ada-program');

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Program tidak ditemukan.');
  });

  it('shows a Program whose Impact Report is not written yet, as such', async () => {
    holder.db.programs[0].impactReport = null;

    const res = await get('klinik-keliling');

    expect((await res.json()).program.impactReport).toBeNull();
  });

  it('writes nothing', async () => {
    const before = holder.db.programs.map((r) => ({ ...r }));

    await get('klinik-keliling');

    expect(holder.db.programs).toEqual(before);
  });

  it.each([
    ['a collected figure', 'collected'],
    ['a donation count', 'donation'],
    ['a payment method', 'payment'],
    ['a payout', 'payout'],
    ['a balance', 'balance'],
  ])('surfaces no %s', async (_label, forbidden) => {
    const raw = JSON.stringify(await (await get('klinik-keliling')).json());

    expect(raw.toLowerCase()).not.toContain(forbidden);
  });

  // reportedAmount is real CSR money that never crossed the platform's
  // account. csr-08 shows it on the Program PAGE, beside the ledger-backed
  // Program Balance (src/lib/program-money.ts); this catalog payload stays
  // free of every money figure, so the two cannot be read apart here.
  it('keeps the off-books reported figure out of the catalog payload', async () => {
    holder.db.programs[0].reportedAmount = 50000000;
    holder.db.programs[0].reportedNote = 'Dana CSR mitra yang disalurkan langsung.';

    const raw = JSON.stringify(await (await get('klinik-keliling')).json());

    expect(raw).not.toContain('reportedAmount');
    expect(raw).not.toContain('reportedNote');
  });
});

describe('PATCH /api/programs/[slug]', () => {
  it('edits the Program the slug names, as the acting Admin', async () => {
    const res = await patch('klinik-keliling', { title: 'Klinik Keliling Pesisir', reportedAmount: 10000000 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      program: expect.objectContaining({ title: 'Klinik Keliling Pesisir', reportedAmount: 10000000 }),
    });
    expect(holder.db.programs[0]).toMatchObject({ title: 'Klinik Keliling Pesisir', reportedAmount: 10000000 });
  });

  it('answers 404 for a slug no Program has', async () => {
    const res = await patch('tidak-ada-program', { title: 'Baru' });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Program tidak ditemukan.');
  });

  it('answers 400 with the reason for an invalid change, writing nothing', async () => {
    const res = await patch('klinik-keliling', { budget: -5 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Anggaran Program tidak boleh negatif.');
    expect(holder.db.programs[0].budget).toBe(500000000);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const res = await PATCH(new NextRequest(URL, { method: 'PATCH', body: 'nope' }), {
      params: Promise.resolve({ slug: 'klinik-keliling' }),
    });

    expect(res.status).toBe(400);
  });

  it.each([
    ['nobody signed in', null, 401],
    ['a Verifier without the ADMIN assignment', { user: { id: 'verifier-1', assignments: ['VERIFIER'] } }, 403],
    ['a Fundraiser', { user: { id: 'creator-1', assignments: [] } }, 403],
  ])('refuses %s, writing nothing', async (_name, session, status) => {
    mockSession.mockResolvedValue(session);

    expect((await patch('klinik-keliling', { title: 'Baru' })).status).toBe(status);
    expect(holder.db.programs[0].title).toBe('Klinik Keliling');
  });
});
