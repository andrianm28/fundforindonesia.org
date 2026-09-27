import type { PrismaClient, Program } from "@/generated/prisma/client";

/**
 * CSR Programs (ticket csr-01; CONTEXT.md, Program): catalog items an Admin
 * creates and edits from the panel. A Program never takes money online, so
 * there is deliberately no Kind here and no path to Donation, Payment,
 * Refund, Payout, or the ledger -- see program-money-isolation.test.ts, which
 * enforces that at the schema level.
 *
 * Callers establish the ADMIN Capacity (the routes do, through
 * withAssignmentCheck); these commands take no actor, because a Program
 * write is a catalog edit, not an audited money movement.
 */

/** The four fixed Sectors (CONTEXT.md, Sector): code, not a table. */
export const SECTORS = ['HEALTH', 'EDUCATION', 'ENVIRONMENT', 'DISABILITY_INCLUSION'] as const;

export type SectorValue = (typeof SECTORS)[number];

export class ProgramNotFoundError extends Error {
  constructor() {
    super('Program tidak ditemukan.');
    this.name = 'ProgramNotFoundError';
  }
}

export class InvalidProgramInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProgramInputError';
  }
}

/** The HTTP answer for a refusal from this module, or null for anything else. */
export function programErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof ProgramNotFoundError) return { status: 404, error: error.message };
  if (error instanceof InvalidProgramInputError) return { status: 400, error: error.message };
  return null;
}

const MAX_TITLE_LENGTH = 200;
const MAX_SHORT_LENGTH = 300;
const MAX_TEXT_LENGTH = 5000;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_LENGTH = 500;
const MAX_SLUG_LENGTH = 100;

function cleanText(
  value: unknown,
  { field, max, required, nullable = false }: { field: string; max: number; required: boolean; nullable?: boolean },
): string | null | undefined {
  if (value === undefined) {
    if (required) throw new InvalidProgramInputError(`${field} wajib diisi.`);
    return undefined;
  }
  // Blank clears a nullable field; a field with no null state refuses it,
  // on create and on update alike, so a PATCH cannot empty a title by typo.
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    if (nullable) return null;
    throw new InvalidProgramInputError(`${field} wajib diisi.`);
  }
  if (typeof value !== 'string') throw new InvalidProgramInputError(`${field} harus berupa teks.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new InvalidProgramInputError(`${field} paling panjang ${max} karakter.`);
  return trimmed;
}

function cleanMoney(value: unknown, { field, required }: { field: string; required: boolean }): number | null {
  if (value === undefined || value === null) {
    if (required) throw new InvalidProgramInputError(`${field} wajib diisi.`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new InvalidProgramInputError(`${field} harus berupa angka rupiah bulat.`);
  }
  if (value < 0) throw new InvalidProgramInputError(`${field} tidak boleh negatif.`);
  return value;
}

function cleanSector(value: unknown, required: boolean): SectorValue | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new InvalidProgramInputError('Sektor Program wajib diisi.');
    return null;
  }
  if (typeof value !== 'string' || !(SECTORS as readonly string[]).includes(value)) {
    throw new InvalidProgramInputError('Sektor Program tidak dikenal.');
  }
  return value as SectorValue;
}

function cleanList(value: unknown, field: string): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new InvalidProgramInputError(`${field} harus berupa daftar.`);
  if (value.length > MAX_LIST_ITEMS) {
    throw new InvalidProgramInputError(`${field} paling banyak ${MAX_LIST_ITEMS} baris.`);
  }
  return value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new InvalidProgramInputError(`Setiap baris ${field} wajib diisi.`);
    }
    const trimmed = item.trim();
    if (trimmed.length > MAX_LIST_ITEM_LENGTH) {
      throw new InvalidProgramInputError(`Setiap baris ${field} paling panjang ${MAX_LIST_ITEM_LENGTH} karakter.`);
    }
    return trimmed;
  });
}

function cleanDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) throw new InvalidProgramInputError(`${field} tidak valid.`);
  return date;
}

function cleanSlug(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > MAX_SLUG_LENGTH) {
    throw new InvalidProgramInputError('Slug Program hanya boleh huruf kecil, angka, dan tanda hubung.');
  }
  return value;
}

/** Derives a URL slug from a title: lowercase, dashes, nothing else. */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug === '' ? 'program' : slug;
}

export type ProgramCreateInput = {
  title: unknown;
  slug?: unknown;
  sector: unknown;
  problem: unknown;
  beneficiaries: unknown;
  location: unknown;
  activities: unknown;
  budget: unknown;
  timeline: unknown;
  kpis?: unknown;
  documentation?: unknown;
  impactReport?: unknown;
  reportedAmount?: unknown;
  reportedAsOf?: unknown;
  reportedNote?: unknown;
};

export type ProgramUpdateInput = Partial<
  Pick<
    ProgramCreateInput,
    | 'title'
    | 'slug'
    | 'sector'
    | 'problem'
    | 'beneficiaries'
    | 'location'
    | 'activities'
    | 'budget'
    | 'timeline'
    | 'kpis'
    | 'documentation'
    | 'impactReport'
    | 'reportedAmount'
    | 'reportedAsOf'
    | 'reportedNote'
  >
>;

type CleanedProgram = {
  title: string | undefined;
  slug: string | null;
  sector: SectorValue | null;
  problem: string | undefined;
  beneficiaries: string | undefined;
  location: string | undefined;
  activities: string | undefined;
  budget: number | null;
  timeline: string | undefined;
  kpis: string[] | null;
  documentation: string[] | null;
  impactReport: string | null | undefined;
  reportedAmount: number | null;
  reportedAsOf: Date | null;
  reportedNote: string | null | undefined;
};

function cleanCommon(input: ProgramUpdateInput, required: boolean): CleanedProgram {
  return {
    title: cleanText(input.title, { field: 'Judul Program', max: MAX_TITLE_LENGTH, required }) as string | undefined,
    slug: cleanSlug(input.slug),
    sector: cleanSector(input.sector, required),
    problem: cleanText(input.problem, { field: 'Masalah yang dijawab Program', max: MAX_TEXT_LENGTH, required }) as string | undefined,
    beneficiaries: cleanText(input.beneficiaries, { field: 'Penerima manfaat Program', max: MAX_TEXT_LENGTH, required }) as string | undefined,
    location: cleanText(input.location, { field: 'Lokasi Program', max: MAX_SHORT_LENGTH, required }) as string | undefined,
    activities: cleanText(input.activities, { field: 'Kegiatan Program', max: MAX_TEXT_LENGTH, required }) as string | undefined,
    budget: cleanMoney(input.budget, { field: 'Anggaran Program', required }),
    timeline: cleanText(input.timeline, { field: 'Linimasa Program', max: MAX_SHORT_LENGTH, required }) as string | undefined,
    kpis: cleanList(input.kpis, 'KPI Program'),
    documentation: cleanList(input.documentation, 'Dokumentasi Program'),
    impactReport: cleanText(input.impactReport, { field: 'Laporan dampak Program', max: MAX_TEXT_LENGTH, required: false, nullable: true }),
    reportedAmount: cleanMoney(input.reportedAmount, { field: 'Angka di luar pembukuan', required: false }),
    reportedAsOf: cleanDate(input.reportedAsOf, 'Tanggal angka di luar pembukuan'),
    reportedNote: cleanText(input.reportedNote, { field: 'Catatan angka di luar pembukuan', max: MAX_SHORT_LENGTH, required: false, nullable: true }),
  };
}

type ProgramDelegate = {
  findUnique(args: { where: Record<string, unknown> }): Promise<Program | null>;
  create(args: { data: Record<string, unknown> }): Promise<Program>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Program>;
};

function delegateOf(prisma: PrismaClient): ProgramDelegate {
  return prisma.program as unknown as ProgramDelegate;
}

async function uniqueSlug(
  delegate: ProgramDelegate,
  base: string,
  ignoreId: string | null,
): Promise<string> {
  let candidate = base;
  for (let n = 2; ; n += 1) {
    const taken = await delegate.findUnique({ where: { slug: candidate } });
    if (!taken || taken.id === ignoreId) return candidate;
    candidate = `${base}-${n}`;
  }
}

/** Creates a Program with a slug derived from its title unless one is given. */
export async function createProgram(prisma: PrismaClient, input: ProgramCreateInput): Promise<Program> {
  const cleaned = cleanCommon(input, true);
  // cleanText already refused a missing title on the required path; this guard
  // states the invariant the slug below relies on, rather than casting it away.
  if (cleaned.title === undefined) throw new InvalidProgramInputError('Judul Program wajib diisi.');
  const delegate = delegateOf(prisma);
  const slug = await uniqueSlug(delegate, cleaned.slug ?? slugifyTitle(cleaned.title), null);

  return delegate.create({
    data: {
      title: cleaned.title,
      slug,
      sector: cleaned.sector,
      problem: cleaned.problem,
      beneficiaries: cleaned.beneficiaries,
      location: cleaned.location,
      activities: cleaned.activities,
      budget: cleaned.budget,
      timeline: cleaned.timeline,
      kpis: cleaned.kpis ?? [],
      documentation: cleaned.documentation ?? [],
      impactReport: cleaned.impactReport,
      reportedAmount: cleaned.reportedAmount ?? 0,
      reportedAsOf: cleaned.reportedAsOf,
      reportedNote: cleaned.reportedNote,
    },
  });
}

/** Edits a Program: every field optional, but at least one change is required. */
export async function updateProgram(
  prisma: PrismaClient,
  params: { programId: string; changes: ProgramUpdateInput },
): Promise<Program> {
  const delegate = delegateOf(prisma);
  const current = await delegate.findUnique({ where: { id: params.programId } });
  if (!current) throw new ProgramNotFoundError();

  const cleaned = cleanCommon(params.changes, false);
  const data: Record<string, unknown> = {};
  if (cleaned.title !== undefined) data.title = cleaned.title;
  if (cleaned.sector !== null) data.sector = cleaned.sector;
  if (cleaned.problem !== undefined) data.problem = cleaned.problem;
  if (cleaned.beneficiaries !== undefined) data.beneficiaries = cleaned.beneficiaries;
  if (cleaned.location !== undefined) data.location = cleaned.location;
  if (cleaned.activities !== undefined) data.activities = cleaned.activities;
  if (cleaned.budget !== null) data.budget = cleaned.budget;
  if (cleaned.timeline !== undefined) data.timeline = cleaned.timeline;
  if (cleaned.kpis !== null) data.kpis = cleaned.kpis;
  if (cleaned.documentation !== null) data.documentation = cleaned.documentation;
  if (cleaned.impactReport !== undefined) data.impactReport = cleaned.impactReport;
  if (cleaned.reportedAmount !== null) data.reportedAmount = cleaned.reportedAmount;
  if (params.changes.reportedAsOf !== undefined) data.reportedAsOf = cleaned.reportedAsOf;
  if (cleaned.reportedNote !== undefined) data.reportedNote = cleaned.reportedNote;
  if (cleaned.slug !== null && cleaned.slug !== current.slug) {
    const clash = await delegate.findUnique({ where: { slug: cleaned.slug } });
    if (clash && clash.id !== current.id) {
      throw new InvalidProgramInputError('Slug Program sudah dipakai Program lain.');
    }
    data.slug = cleaned.slug;
  }
  if (Object.keys(data).length === 0) {
    throw new InvalidProgramInputError('Tidak ada perubahan untuk Program.');
  }

  return delegate.update({ where: { id: current.id }, data });
}
