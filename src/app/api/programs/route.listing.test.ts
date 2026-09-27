import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeProgramDb, programRow, type ProgramRow } from '../../../../tests/support/in-memory-program-db';

/**
 * The public CSR portfolio list, GET /api/programs (ticket csr-04; PRD
 * FFI-09): Programs grouped by the four fixed Sectors, and never anything a
 * Program cannot be mistaken for. A Program takes no money online (ADR 0002),
 * so the payload carries the catalog and nothing from the ledger -- the test
 * pins the exact key set rather than scanning for a word.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-program-db').makeProgramDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key: string) => (holder.db.prisma as Record<string, unknown>)[key] }),
}));

import { GET } from './route';

function program(slug: string, sector: ProgramRow['sector'], overrides: Partial<ProgramRow> = {}): ProgramRow {
  return programRow({ id: slug, slug, title: slug, sector, ...overrides });
}

async function list(query = ''): Promise<Response> {
  return GET(new NextRequest(new URL(`http://localhost:3000/api/programs${query}`)));
}

/** The Programs of one Sector, by Sector code, in the order the payload lists them. */
async function slugsIn(sector: string, query = ''): Promise<string[]> {
  const response = await list(query);
  expect(response.status).toBe(200);
  const body = await response.json();
  const group = body.sectors.find((s: { sector: string }) => s.sector === sector);
  return (group?.programs ?? []).map((p: { slug: string }) => p.slug);
}

beforeEach(() => {
  holder.db = makeProgramDb({
    programs: [
      program('klinik-keliling', 'HEALTH'),
      program('sekolah-lapang', 'EDUCATION'),
      program('tanam-hutan', 'ENVIRONMENT'),
      program('kelas-braille', 'DISABILITY_INCLUSION'),
      program('posyandu-desa', 'HEALTH'),
    ],
  });
});

describe('GET /api/programs groups Programs by the four fixed Sectors', () => {
  it('always answers all four Sectors, in the fixed order, with the ones it lists', async () => {
    const body = await (await list()).json();

    expect(body.sectors.map((s: { sector: string }) => s.sector)).toEqual([
      'HEALTH',
      'EDUCATION',
      'ENVIRONMENT',
      'DISABILITY_INCLUSION',
    ]);
    expect(body.sectors.map((s: { label: string }) => s.label)).toEqual([
      'Kesehatan',
      'Pendidikan',
      'Lingkungan',
      'Inklusi Penyandang Disabilitas',
    ]);
  });

  it('puts each Program in its own Sector', async () => {
    expect(await slugsIn('HEALTH')).toEqual(['klinik-keliling', 'posyandu-desa']);
    expect(await slugsIn('EDUCATION')).toEqual(['sekolah-lapang']);
    expect(await slugsIn('ENVIRONMENT')).toEqual(['tanam-hutan']);
    expect(await slugsIn('DISABILITY_INCLUSION')).toEqual(['kelas-braille']);
  });

  it('lists a Sector with no Programs as an empty group rather than dropping it', async () => {
    holder.db = makeProgramDb({ programs: [program('klinik-keliling', 'HEALTH')] });

    const body = await (await list()).json();
    const empty = body.sectors.filter((s: { programs: unknown[] }) => s.programs.length === 0);

    expect(body.sectors).toHaveLength(4);
    expect(empty.map((s: { sector: string }) => s.sector)).toEqual([
      'EDUCATION',
      'ENVIRONMENT',
      'DISABILITY_INCLUSION',
    ]);
  });

  it('narrows the list to one Sector when asked, and accepts it in lower case as links write it', async () => {
    expect(await slugsIn('HEALTH', '?sector=HEALTH')).toEqual(['klinik-keliling', 'posyandu-desa']);
    expect(await slugsIn('HEALTH', '?sector=health')).toEqual(['klinik-keliling', 'posyandu-desa']);

    const body = await (await list('?sector=education')).json();
    expect(body.sectors.filter((s: { programs: unknown[] }) => s.programs.length > 0)).toHaveLength(1);
  });

  it('answers 400 to a Sector the platform does not know, rather than an empty portfolio', async () => {
    const response = await list('?sector=perkawinan');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Sektor Program tidak dikenal.');
  });

  it('counts only what it lists', async () => {
    expect((await (await list()).json()).total).toBe(5);
    expect((await (await list('?sector=ENVIRONMENT')).json()).total).toBe(1);
  });

  it('writes nothing while listing', async () => {
    const before = holder.db.programs.map((p) => ({ ...p }));

    await list();

    expect(holder.db.programs).toEqual(before);
  });
});

describe('GET /api/programs surfaces nothing a Program cannot be', () => {
  /** What one card in a Sector group may carry: the catalog, and no money subject. */
  const CARD_KEYS = ['slug', 'title', 'sector', 'location', 'budget', 'timeline'];

  it('answers with the catalog fields and nothing else', async () => {
    const body = await (await list()).json();
    const cards = body.sectors.flatMap((s: { programs: Record<string, unknown>[] }) => s.programs);

    expect(cards).toHaveLength(5);
    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual([...CARD_KEYS].sort());
    }
  });

  // ADR 0002: one Campaign entity takes all online money, and a Program is
  // not one. Nothing in the portfolio may be read as money a visitor can give
  // or take out.
  it.each([
    ['a collected figure', 'collected'],
    ['a donation count', 'donation'],
    ['a payment method', 'payment'],
    ['a payout', 'payout'],
    ['a balance', 'balance'],
  ])('carries no %s', async (_label, forbidden) => {
    const response = await list('?sector=HEALTH');
    const raw = JSON.stringify(await response.json());

    expect(raw.toLowerCase()).not.toContain(forbidden);
  });

  it('leaves the off-books reported figure to ticket csr-08, which shows it beside Program Balance', async () => {
    const raw = JSON.stringify(await (await list()).json());

    // reportedAmount is real CSR money that never crossed the platform's
    // account. It is reported next to the ledger-backed Program Balance (which
    // does not exist yet, ticket 07), so a portfolio card that printed it
    // alone would be a number with nothing to be compared against.
    expect(raw).not.toContain('reportedAmount');
  });
});
