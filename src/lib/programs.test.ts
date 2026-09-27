import { describe, it, expect, beforeEach } from 'vitest';

/**
 * The Program service seam (ticket 01): an Admin creates and edits CSR
 * catalog Programs through createProgram / updateProgram. The database is a
 * tiny in-memory stand-in for the `program` model only; tests assert on the
 * program returned and the rows left behind, never on which Prisma methods
 * were called.
 */
import {
  createProgram,
  updateProgram,
  programErrorToHttp,
  ProgramNotFoundError,
  InvalidProgramInputError,
  type ProgramCreateInput,
} from './programs';

type ProgramRow = {
  id: string;
  slug: string;
  title: string;
  sector: string;
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

function makeProgramDb(seed: Partial<ProgramRow>[] = []) {
  const rows: ProgramRow[] = seed.map((partial, index) => ({
    id: `program-${index + 1}`,
    slug: `program-${index + 1}`,
    title: `Program ${index + 1}`,
    sector: 'HEALTH',
    problem: 'Masalah yang dihadapi komunitas.',
    beneficiaries: 'Warga desa pesisir.',
    location: 'Pesisir Selatan',
    activities: 'Pelatihan dan pendampingan.',
    budget: 100000000,
    timeline: 'Jan–Des 2027',
    kpis: [],
    documentation: [],
    impactReport: null,
    reportedAmount: 0,
    reportedAsOf: null,
    reportedNote: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  }));
  let nextId = rows.length + 1;

  const findOne = (where: Record<string, unknown>): ProgramRow | null =>
    rows.find((row) =>
      Object.entries(where).every(([key, value]) => row[key as keyof ProgramRow] === value),
    ) ?? null;

  const prisma = {
    program: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        const row = findOne(where);
        return row ? { ...row } : null;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = findOne(where);
        return row ? { ...row } : null;
      },
      create: async ({ data }: { data: Omit<ProgramRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
        if (rows.some((row) => row.slug === data.slug)) {
          throw new Error('Unique constraint failed on Program.slug');
        }
        const row: ProgramRow = {
          ...data,
          id: `program-${nextId++}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<ProgramRow> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('No Program found');
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
    },
  };

  return { prisma, rows };
}

const VALID: ProgramCreateInput = {
  title: 'Sekolah Lapang Petani Pesisir',
  sector: 'EDUCATION',
  problem: 'Petani pesisir kekurangan akses ke teknik budidaya modern.',
  beneficiaries: '250 petani di tiga desa pesisir.',
  location: 'Pesisir Selatan, Jawa Barat',
  activities: 'Pelatihan bulanan, demplot, dan pendampingan lapangan.',
  budget: 250000000,
  timeline: 'Jan–Des 2027',
  kpis: ['250 petani lulus pelatihan', 'Hasil panen naik 20%'],
  documentation: ['https://contoh.test/rencana.pdf'],
  impactReport: 'Angkatan pertama lulus dengan nilai memuaskan.',
  reportedAmount: 50000000,
  reportedAsOf: '2026-06-30',
  reportedNote: 'Dana CSR mitra yang disalurkan langsung.',
};

describe('createProgram', () => {
  let db: ReturnType<typeof makeProgramDb>;

  beforeEach(() => {
    db = makeProgramDb();
  });

  it('creates a Program with every ticket-01 field and a slug derived from the title', async () => {
    const program = await createProgram(db.prisma as never, VALID);

    expect(program.slug).toBe('sekolah-lapang-petani-pesisir');
    expect(program).toMatchObject({
      title: 'Sekolah Lapang Petani Pesisir',
      sector: 'EDUCATION',
      problem: VALID.problem,
      beneficiaries: VALID.beneficiaries,
      location: VALID.location,
      activities: VALID.activities,
      budget: 250000000,
      timeline: 'Jan–Des 2027',
      kpis: ['250 petani lulus pelatihan', 'Hasil panen naik 20%'],
      documentation: ['https://contoh.test/rencana.pdf'],
      impactReport: 'Angkatan pertama lulus dengan nilai memuaskan.',
      reportedAmount: 50000000,
      reportedNote: 'Dana CSR mitra yang disalurkan langsung.',
    });
    expect(program.reportedAsOf).toEqual(new Date('2026-06-30'));
    expect(db.rows).toHaveLength(1);
  });

  it('suffixes the slug when the title-derived slug is taken', async () => {
    db = makeProgramDb([{ slug: 'sekolah-lapang-petani-pesisir' }]);

    const program = await createProgram(db.prisma as never, VALID);

    expect(program.slug).toBe('sekolah-lapang-petani-pesisir-2');
  });

  it('keeps an explicit slug when it is free', async () => {
    const program = await createProgram(db.prisma as never, { ...VALID, slug: 'sekolah-lapang' });

    expect(program.slug).toBe('sekolah-lapang');
  });

  it.each([
    ['a blank title', { title: '  ' }, 'Judul Program wajib diisi.'],
    ['an unknown sector', { sector: 'HEALTHCARE' }, 'Sektor Program tidak dikenal.'],
    ['a missing sector', { sector: undefined }, 'Sektor Program wajib diisi.'],
    ['a negative budget', { budget: -1 }, 'Anggaran Program tidak boleh negatif.'],
    ['a missing problem', { problem: '' }, 'Masalah yang dijawab Program wajib diisi.'],
    ['a missing location', { location: '' }, 'Lokasi Program wajib diisi.'],
    ['kpis that are not a list', { kpis: 'naik 20%' }, 'KPI Program harus berupa daftar.'],
    ['a negative reported figure', { reportedAmount: -1000 }, 'Angka di luar pembukuan tidak boleh negatif.'],
    ['a malformed slug', { slug: 'Sekolah Lapang!' }, 'Slug Program hanya boleh huruf kecil, angka, dan tanda hubung.'],
  ])('refuses %s and writes nothing', async (_name, override, message) => {
    await expect(createProgram(db.prisma as never, { ...VALID, ...override })).rejects.toThrow(message);
    expect(db.rows).toHaveLength(0);
  });
});

describe('updateProgram', () => {
  let db: ReturnType<typeof makeProgramDb>;

  beforeEach(() => {
    db = makeProgramDb([{ id: 'program-1', slug: 'sekolah-lapang', sector: 'HEALTH' }]);
  });

  it('edits content, money, and the off-books figure while keeping the slug', async () => {
    const program = await updateProgram(db.prisma as never, {
      programId: 'program-1',
      changes: {
        title: 'Sekolah Lapang Nelayan',
        sector: 'ENVIRONMENT',
        budget: 300000000,
        impactReport: 'Laporan dampak semester pertama terbit.',
        reportedAmount: 75000000,
        reportedNote: 'Revisi angka mitra.',
      },
    });

    expect(program).toMatchObject({
      title: 'Sekolah Lapang Nelayan',
      sector: 'ENVIRONMENT',
      budget: 300000000,
      slug: 'sekolah-lapang',
      reportedAmount: 75000000,
    });
    expect(db.rows[0]).toMatchObject({ title: 'Sekolah Lapang Nelayan', reportedAmount: 75000000 });
  });

  it('moves to an explicit free slug', async () => {
    const program = await updateProgram(db.prisma as never, {
      programId: 'program-1',
      changes: { slug: 'sekolah-nelayan' },
    });

    expect(program.slug).toBe('sekolah-nelayan');
  });

  it('refuses an unknown id', async () => {
    await expect(
      updateProgram(db.prisma as never, { programId: 'program-99', changes: { title: 'Baru' } }),
    ).rejects.toBeInstanceOf(ProgramNotFoundError);
  });

  it('refuses an empty change set', async () => {
    await expect(updateProgram(db.prisma as never, { programId: 'program-1', changes: {} })).rejects.toThrow(
      'Tidak ada perubahan untuk Program.',
    );
  });

  it('refuses a slug taken by another Program', async () => {
    db = makeProgramDb([
      { id: 'program-1', slug: 'sekolah-lapang' },
      { id: 'program-2', slug: 'klinik-keliling' },
    ]);

    await expect(
      updateProgram(db.prisma as never, { programId: 'program-1', changes: { slug: 'klinik-keliling' } }),
    ).rejects.toThrow('Slug Program sudah dipakai Program lain.');
    expect(db.rows[0].slug).toBe('sekolah-lapang');
  });

  it('refuses an invalid value and writes nothing', async () => {
    await expect(
      updateProgram(db.prisma as never, { programId: 'program-1', changes: { budget: -5 } }),
    ).rejects.toThrow('Anggaran Program tidak boleh negatif.');
    expect(db.rows[0].budget).toBe(100000000);
  });
});

describe('programErrorToHttp', () => {
  it('maps a missing Program to 404 and a refusal to 400', () => {
    expect(programErrorToHttp(new ProgramNotFoundError())).toEqual({
      status: 404,
      error: 'Program tidak ditemukan.',
    });
    expect(programErrorToHttp(new InvalidProgramInputError('Judul Program wajib diisi.'))).toEqual({
      status: 400,
      error: 'Judul Program wajib diisi.',
    });
    expect(programErrorToHttp(new Error('boom'))).toBeNull();
  });
});
