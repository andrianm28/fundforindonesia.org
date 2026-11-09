// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import type { PrismaClient } from '@/generated/prisma/client';
import { anonymiseExpiredCompanies } from './tim-csr';

/**
 * Retention of Partnership Inquiry contact data (decision 2026-10-04 (d),
 * pks-pemenuhan/17 review): when an Inquiry's person is anonymised its
 * proposal PDF goes too (the bytes; the Document row stays, "documents are
 * never deleted"), and an Inquiry filed on the public form, which belongs to
 * no company, follows the same two-year period from the day it was filed.
 */

const NOW = new Date('2026-11-09T00:00:00Z');
const OLD = new Date('2020-01-01T00:00:00Z');
const RECENT = new Date('2026-06-01T00:00:00Z');
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x31]);

type Inquiry = { id: string; companyId: string | null; createdAt: Date; contactAnonymisedAt: Date | null };
type Doc = { id: string; partnershipInquiryId: string | null; storagePath: string };

const PATH_A = `aa/${'a'.repeat(64)}`;
const PATH_B = `bb/${'b'.repeat(64)}`;
const PATH_C = `cc/${'c'.repeat(64)}`;
const PATH_D = `dd/${'d'.repeat(64)}`;

function makeDb(seed: {
  companies: Array<{ id: string; createdAt: Date; anonymisedAt: Date | null }>;
  inquiries: Inquiry[];
  documents: Doc[];
}) {
  const state = { ...seed, anonymisedByRaw: [] as string[], membershipsDeleted: [] as string[] };
  const tx = {
    $queryRaw: async (_s: TemplateStringsArray, id: string) =>
      state.companies.filter((c) => c.id === id && c.anonymisedAt === null).map((c) => ({ id: c.id })),
    $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      // The ids ride in a Prisma.join fragment; the guard columns are in the SQL text.
      const fragment = values.find((v) => typeof v === 'object' && v !== null && 'values' in v) as { values: string[] };
      const sql = _s.join('?');
      expect(sql).toContain('"contactAnonymisedAt" IS NULL');
      for (const row of state.inquiries) {
        if (fragment.values.includes(row.id) && row.contactAnonymisedAt === null) {
          row.contactAnonymisedAt = values.find((v) => v instanceof Date) as Date;
          state.anonymisedByRaw.push(row.id);
        }
      }
      return fragment.values.length;
    },
    company: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => state.companies.find((c) => c.id === where.id)!,
      update: async ({ where, data }: { where: { id: string }; data: { anonymisedAt: Date } }) => {
        state.companies.find((c) => c.id === where.id)!.anonymisedAt = data.anonymisedAt;
      },
    },
    companyMembership: {
      aggregate: async () => ({ _max: { createdAt: null } }),
      deleteMany: async ({ where }: { where: { companyId: string } }) => {
        state.membershipsDeleted.push(where.companyId);
      },
    },
    partnershipInquiry: {
      aggregate: async ({ where }: { where: { companyId: string } }) => ({
        _max: {
          createdAt: state.inquiries
            .filter((i) => i.companyId === where.companyId)
            .reduce<Date | null>((max, i) => (!max || i.createdAt > max ? i.createdAt : max), null),
        },
      }),
      findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const createdLte = (where.createdAt as { lte?: Date } | undefined)?.lte;
        const rows = state.inquiries.filter(
          (i) =>
            (!('companyId' in where) || i.companyId === where.companyId) &&
            (!('contactAnonymisedAt' in where) || i.contactAnonymisedAt === where.contactAnonymisedAt) &&
            (!createdLte || i.createdAt <= createdLte),
        );
        return rows.slice(0, take ?? rows.length).map((i) => ({ id: i.id }));
      },
    },
    document: {
      findMany: async ({ where }: { where: { partnershipInquiryId: { in: string[] } } }) =>
        state.documents
          .filter((d) => d.partnershipInquiryId && where.partnershipInquiryId.in.includes(d.partnershipInquiryId))
          .map((d) => ({ storagePath: d.storagePath })),
    },
  };
  const prisma = {
    company: {
      findMany: async ({ where }: { where: { createdAt: { lte: Date } } }) =>
        state.companies.filter((c) => c.anonymisedAt === null && c.createdAt <= where.createdAt.lte).map((c) => ({ id: c.id })),
    },
    partnershipInquiry: tx.partnershipInquiry,
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };
  return { state, prisma: prisma as unknown as PrismaClient };
}

let root: string;
async function put(path: string) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, PDF);
}
async function exists(path: string) {
  return readFile(join(root, path)).then(
    () => true,
    () => false,
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'retention-'));
  vi.stubEnv('PRIVATE_DOCUMENT_DIR', root);
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('anonymiseExpiredCompanies: proposal documents', () => {
  it('erases the stored file of an expired company Inquiry, and nobody else files', async () => {
    await Promise.all([PATH_A, PATH_B].map(put));
    const { prisma, state } = makeDb({
      companies: [
        { id: 'co-old', createdAt: OLD, anonymisedAt: null },
        { id: 'co-new', createdAt: RECENT, anonymisedAt: null },
      ],
      inquiries: [
        { id: 'inq-old', companyId: 'co-old', createdAt: OLD, contactAnonymisedAt: null },
        { id: 'inq-new', companyId: 'co-new', createdAt: RECENT, contactAnonymisedAt: null },
      ],
      documents: [
        { id: 'doc-old', partnershipInquiryId: 'inq-old', storagePath: PATH_A },
        { id: 'doc-new', partnershipInquiryId: 'inq-new', storagePath: PATH_B },
      ],
    });

    const result = await anonymiseExpiredCompanies(prisma, NOW);

    expect(result.anonymisedCount).toBe(1);
    expect(await exists(PATH_A)).toBe(false);
    expect(await exists(PATH_B)).toBe(true);
    // The Document row is never deleted: the fake has no delete, so a call would have thrown.
    expect(state.documents).toHaveLength(2);
    expect(state.anonymisedByRaw).toEqual(['inq-old']);
  });

  it('is idempotent: a file already gone is not an error, and a second run changes nothing', async () => {
    const { prisma } = makeDb({
      companies: [{ id: 'co-old', createdAt: OLD, anonymisedAt: null }],
      inquiries: [{ id: 'inq-old', companyId: 'co-old', createdAt: OLD, contactAnonymisedAt: null }],
      documents: [{ id: 'doc-old', partnershipInquiryId: 'inq-old', storagePath: PATH_A }],
    });

    await expect(anonymiseExpiredCompanies(prisma, NOW)).resolves.toMatchObject({ anonymisedCount: 1 });
    await expect(anonymiseExpiredCompanies(prisma, NOW)).resolves.toMatchObject({ anonymisedCount: 0 });
  });

  it('never touches a path outside the store, even if a row names one', async () => {
    const outside = join(root, '..', 'retention-outside.txt');
    await writeFile(outside, 'keep');
    const { prisma } = makeDb({
      companies: [{ id: 'co-old', createdAt: OLD, anonymisedAt: null }],
      inquiries: [{ id: 'inq-old', companyId: 'co-old', createdAt: OLD, contactAnonymisedAt: null }],
      documents: [{ id: 'doc-old', partnershipInquiryId: 'inq-old', storagePath: '../retention-outside.txt' }],
    });

    await anonymiseExpiredCompanies(prisma, NOW);

    expect(await readFile(outside, 'utf8')).toBe('keep');
    await rm(outside, { force: true });
  });
});

describe('anonymiseExpiredCompanies: Inquiries from the public form (no company)', () => {
  it('anonymises one filed more than two years ago, with its proposal file, and keeps a recent one', async () => {
    await Promise.all([PATH_C, PATH_D].map(put));
    const { prisma, state } = makeDb({
      companies: [],
      inquiries: [
        { id: 'pub-old', companyId: null, createdAt: OLD, contactAnonymisedAt: null },
        { id: 'pub-new', companyId: null, createdAt: RECENT, contactAnonymisedAt: null },
      ],
      documents: [
        { id: 'doc-c', partnershipInquiryId: 'pub-old', storagePath: PATH_C },
        { id: 'doc-d', partnershipInquiryId: 'pub-new', storagePath: PATH_D },
      ],
    });

    const result = await anonymiseExpiredCompanies(prisma, NOW);

    expect(state.anonymisedByRaw).toEqual(['pub-old']);
    expect(result.anonymisedInquiryCount).toBe(1);
    expect(await exists(PATH_C)).toBe(false);
    expect(await exists(PATH_D)).toBe(true);
  });

  it('uses the same cutoff as a company: two years minus a day is kept, two years plus a day is not', async () => {
    const filed = new Date('2024-11-10T00:00:00Z');
    const { prisma, state } = makeDb({
      companies: [],
      inquiries: [{ id: 'pub', companyId: null, createdAt: filed, contactAnonymisedAt: null }],
      documents: [],
    });

    await anonymiseExpiredCompanies(prisma, NOW);
    expect(state.anonymisedByRaw).toEqual([]);

    await anonymiseExpiredCompanies(prisma, new Date('2026-11-12T00:00:00Z'));
    expect(state.anonymisedByRaw).toEqual(['pub']);
  });

  it('does not touch a public Inquiry that is already anonymised', async () => {
    const { prisma, state } = makeDb({
      companies: [],
      inquiries: [{ id: 'pub', companyId: null, createdAt: OLD, contactAnonymisedAt: OLD }],
      documents: [],
    });

    const result = await anonymiseExpiredCompanies(prisma, NOW);

    expect(result.anonymisedInquiryCount).toBe(0);
    expect(state.anonymisedByRaw).toEqual([]);
  });
});
