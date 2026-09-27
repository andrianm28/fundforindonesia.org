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

/**
 * The label a visitor reads for each Sector, next to the code so the two
 * cannot drift apart. Indonesian, like every other label the platform shows;
 * the four values themselves stay the codes the schema stores (ticket csr-04).
 */
export const SECTOR_LABEL: Record<SectorValue, string> = {
  HEALTH: 'Kesehatan',
  EDUCATION: 'Pendidikan',
  ENVIRONMENT: 'Lingkungan',
  DISABILITY_INCLUSION: 'Inklusi Penyandang Disabilitas',
};

/** The Sector a link or a query names, in whatever case it was written, or null. */
export function parseSector(value: unknown): SectorValue | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return (SECTORS as readonly string[]).includes(code) ? (code as SectorValue) : null;
}

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
  findUnique(args: {
    where: Record<string, unknown>;
    select?: Record<string, boolean>;
  }): Promise<Program | null>;
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, boolean>;
    orderBy: Record<string, 'asc' | 'desc'>;
  }): Promise<Program[]>;
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

/**
 * What the public portfolio shows (ticket csr-04; PRD FFI-09).
 *
 * A Program has no lifecycle and no visibility rule -- an Admin writes the
 * catalog and a visitor reads all of it -- so the readers below are plain
 * reads, and the only rule they apply is grouping by the four fixed Sectors.
 *
 * The payload is named field by field rather than handed back as a row, for
 * one reason: it is a promise about what a Program is. Every field below is
 * something a CSR team reads to judge the work. No field is money, because a
 * Program never receives money online (ADR 0002) -- `reportedAmount` is
 * deliberately absent even though the row carries it, since reporting CSR
 * money that never crossed the platform's account only makes sense next to
 * the ledger-backed Program Balance, which lands with ticket 07 (csr-08).
 */
export type ProgramSummary = {
  slug: string;
  title: string;
  sector: SectorValue;
  location: string;
  budget: number;
  timeline: string;
};

export type ProgramSectorGroup = {
  sector: SectorValue;
  label: string;
  programs: ProgramSummary[];
};

export type ProgramPortfolio = {
  /** Always all four Sectors, in the fixed order, empty ones included. */
  sectors: ProgramSectorGroup[];
  total: number;
};

export type ProgramDetail = ProgramSummary & {
  /** The id a Partnership Inquiry names (FFI-10); never a way to give money. */
  id: string;
  problem: string;
  beneficiaries: string;
  activities: string;
  kpis: string[];
  documentation: string[];
  impactReport: string | null;
};

const SUMMARY_SELECT = {
  slug: true,
  title: true,
  sector: true,
  location: true,
  budget: true,
  timeline: true,
} as const;

/**
 * Every Program, grouped by its Sector, optionally narrowed to one Sector.
 *
 * The grouping is done here rather than left to the caller's shape: the four
 * Sectors are fixed, so a Sector with no Program is still a card a visitor is
 * shown, and the order is the order in `SECTORS` rather than whatever the
 * database returned.
 */
export async function listProgramPortfolio(
  prisma: PrismaClient,
  options: { sector?: unknown } = {},
): Promise<ProgramPortfolio> {
  const asked = options.sector;
  // An absent or blank filter lists the whole portfolio; a Sector the
  // platform does not know is a refusal, not an empty list, so a typo in a
  // link cannot read as "we have nothing in this Sector".
  const narrowed = asked !== undefined && asked !== null && asked !== '';
  const sector = narrowed ? parseSector(asked) : null;
  if (narrowed && sector === null) throw new InvalidProgramInputError('Sektor Program tidak dikenal.');

  const rows = (await delegateOf(prisma).findMany({
    where: sector === null ? {} : { sector },
    select: SUMMARY_SELECT,
    orderBy: { title: 'asc' },
  })) as ProgramSummary[];

  return {
    sectors: SECTORS.map((code) => ({
      sector: code,
      label: SECTOR_LABEL[code],
      programs: rows.filter((row) => row.sector === code),
    })),
    total: rows.length,
  };
}

/**
 * One Program as the detail page and the public API show it. Throws
 * ProgramNotFoundError for a slug no Program has, which the routes answer
 * with 404 -- the same answer as a Program that never existed, since every
 * Program is public and there is nothing to keep private here.
 */
export async function readProgram(prisma: PrismaClient, slug: string): Promise<ProgramDetail> {
  const row = (await delegateOf(prisma).findUnique({
    where: { slug },
    select: {
      ...SUMMARY_SELECT,
      id: true,
      problem: true,
      beneficiaries: true,
      activities: true,
      kpis: true,
      documentation: true,
      impactReport: true,
    },
  })) as ProgramDetail | null;
  if (!row) throw new ProgramNotFoundError();
  return row;
}
