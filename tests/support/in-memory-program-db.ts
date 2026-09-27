import type { Sector } from '@/generated/prisma/client';

/**
 * In-memory stand-in for the slice of PrismaClient that the public Program
 * readers touch, in the style of the Campaign one: the real route and page
 * modules run against it, and the tests assert on which Programs come back
 * rather than on how the query was built.
 *
 * A Program has no lifecycle, so there is nothing to decide about visibility
 * here: the only `where` the portfolio asks for is the Sector it was given,
 * and equality that means something different in the database than in memory
 * (a number written as a string) matches nothing rather than everything.
 *
 * Lives outside src/ so the static guards that scan src/ never mistake it for
 * application code.
 */

export type ProgramRow = {
  id: string;
  slug: string;
  title: string;
  sector: Sector;
  problem: string;
  beneficiaries: string;
  location: string;
  activities: string;
  budget: number;
  timeline: string;
  kpis: string[];
  documentation: string[];
  impactReport: string | null;
  reportedAmount: number;
  reportedAsOf: Date | null;
  reportedNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function programRow(overrides: Partial<ProgramRow> = {}): ProgramRow {
  return {
    id: 'program-1',
    slug: 'klinik-keliling-pesisir',
    title: 'Klinik Keliling Pesisir',
    sector: 'HEALTH',
    problem: 'Akses layanan kesehatan dasar di pesisir masih jauh.',
    beneficiaries: '1.000 warga pesisir di tiga kecamatan.',
    location: 'Pesisir Utara, Jawa Barat',
    activities: 'Pemeriksaan rutin, rujukan, dan pendampingan.',
    budget: 500_000_000,
    timeline: 'Jan–Des 2027',
    kpis: ['1.000 warga terlayani', 'Rujukan tepat waktu 90%'],
    documentation: ['https://contoh.test/rencana.pdf'],
    impactReport: 'Quarter pertama: 240 pemeriksaan.',
    reportedAmount: 0,
    reportedAsOf: null,
    reportedNote: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

type Where = Record<string, unknown>;

/**
 * Evaluates the slice of a Prisma `where` the Program readers use: plain
 * equality (null included) with AND / OR / NOT.
 */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'AND') return asList(value).every((w) => matches(row, w));
    if (key === 'OR') return asList(value).some((w) => matches(row, w));
    if (key === 'NOT') return !asList(value).some((w) => matches(row, w));
    return row[key] === value;
  });
}

function asList(value: unknown): Where[] {
  return (Array.isArray(value) ? value : [value]) as Where[];
}

/** Sorts rows by a single-field Prisma `orderBy`, keeping insertion order for ties. */
function ordered<T>(rows: T[], orderBy?: Record<string, 'asc' | 'desc'>): T[] {
  if (!orderBy) return rows;
  const [[field, direction]] = Object.entries(orderBy);
  const sign = direction === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = (a.row as Record<string, unknown>)[field] as string;
      const y = (b.row as Record<string, unknown>)[field] as string;
      return (x < y ? -sign : x > y ? sign : 0) || a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Applies a Prisma `select` to a Program row. */
function shape(row: ProgramRow, select?: Record<string, boolean>): Record<string, unknown> {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.keys(select)
      .filter((key) => select[key])
      .map((key) => [key, row[key as keyof ProgramRow]]),
  );
}

export function makeProgramDb(seed: { programs?: ProgramRow[] } = {}) {
  const rows = (seed.programs ?? []).map((p) => ({ ...p, kpis: [...p.kpis], documentation: [...p.documentation] }));

  const prisma = {
    program: {
      findMany: async ({
        where = {},
        orderBy,
        select,
      }: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'>; select?: Record<string, boolean> } = {}) =>
        ordered(rows.filter((p) => matches(p, where)), orderBy).map((row) => shape(row, select)),
      findUnique: async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
        const row = rows.find((p) => matches(p, where));
        return row ? shape(row, select) : null;
      },
      count: async ({ where = {} }: { where?: Where } = {}) => rows.filter((p) => matches(p, where)).length,
      update: async ({ where, data }: { where: { id: string }; data: Partial<ProgramRow> }) => {
        const row = rows.find((p) => p.id === where.id);
        if (!row) throw new Error('No Program found');
        Object.assign(row, data);
        return { ...row };
      },
    },
  };

  return {
    prisma,
    get programs() {
      return rows;
    },
  };
}
