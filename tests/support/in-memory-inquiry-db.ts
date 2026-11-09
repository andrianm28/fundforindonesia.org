import type { PartnershipBudgetRange, PartnershipInquiryStatus, Sector } from '@/generated/prisma/client';
import {
  sealInquiryCompanyAddress,
  sealInquiryCompanyNpwp,
  sealInquiryContactEmail,
  sealInquiryContactPhone,
} from '@/lib/contact-fields';

/**
 * In-memory stand-in for the slice of PrismaClient that the Partnership
 * Inquiry pipeline touches, in the style of the Program and Campaign ones:
 * the real module and route handlers run against it, and the tests assert on
 * the rows left behind and the answers returned rather than on how the query
 * was built.
 *
 * Three things here are behaviour, not convenience, so they are modelled
 * rather than stubbed:
 *
 * - `partnershipInquiry.updateMany` is PREDICATED. It writes only the rows
 *   whose columns still equal the ones the caller read (status, PIC), and
 *   reports how many it wrote. That is what makes two people moving the same
 *   Inquiry at once end with one refusal instead of one overwrite, so a fake
 *   that ignored the predicate would make the concurrency test prove nothing.
 * - a read that asks for a relation (`program`, `pic`, an actor) must say so in
 *   a nested `select`, and gets only the columns it named, so a test cannot
 *   pass by reading a shape the database would never return. `select` and
 *   `include` together are refused, as real Prisma refuses them.
 * - the contact, address and NPWP columns hold ciphertext, sealed the way the
 *   create path seals them, never plaintext.
 *
 * Lives outside src/ so the static guards that scan src/ never mistake it for
 * application code.
 */

export type InquiryRow = {
  id: string;
  programId: string;
  companyName: string;
  contactName: string;
  needs: string;
  status: PartnershipInquiryStatus;
  budgetRange: PartnershipBudgetRange | null;
  periodStart: string | null;
  periodEnd: string | null;
  picId: string | null;
  createdAt: Date;
  updatedAt: Date;
} & Record<string, unknown>;

export type InquiryChangeRow = {
  id: string;
  inquiryId: string;
  fromStatus: PartnershipInquiryStatus;
  toStatus: PartnershipInquiryStatus;
  actedById: string;
  actedAt: Date;
  note: string | null;
  picChanged: boolean;
  picFromId: string | null;
  picToId: string | null;
};

export type UserRow = { id: string; name: string };

export type ProgramOfInquiry = {
  id: string;
  slug: string;
  title: string;
  sector: Sector;
};

export type DocumentRow = {
  id: string;
  partnershipInquiryId: string;
  label: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
  checklistItemId: null;
};

export function inquiryRow(
  overrides: Partial<InquiryRow> & { contactEmail?: string; contactPhone?: string | null; companyAddress?: string; companyNpwp?: string } = {},
): InquiryRow {
  const { contactEmail, contactPhone, companyAddress, companyNpwp, ...rest } = overrides;
  return {
    id: 'inquiry-1',
    programId: 'program-1',
    companyName: 'PT Sinar Abadi',
    contactName: 'Rina Wijaya',
    needs: 'Kami ingin mendanai logistic dan mobilitas tim kesehatan untuk 12 bulan.',
    status: 'NEW',
    budgetRange: null,
    periodStart: null,
    periodEnd: null,
    picId: null,
    createdAt: new Date('2026-09-27T00:00:00Z'),
    updatedAt: new Date('2026-09-27T00:00:00Z'),
    ...sealInquiryContactEmail(contactEmail ?? 'rina@sinarabadi.test'),
    ...sealInquiryContactPhone(contactPhone === undefined ? '+62 812 3456 7890' : contactPhone),
    ...sealInquiryCompanyAddress(companyAddress ?? null),
    ...sealInquiryCompanyNpwp(companyNpwp ?? null),
    ...rest,
  };
}

export function inquiryChangeRow(overrides: Partial<InquiryChangeRow> = {}): InquiryChangeRow {
  return {
    id: 'change-1',
    inquiryId: 'inquiry-1',
    fromStatus: 'NEW',
    toStatus: 'CONTACTED',
    actedById: 'admin-1',
    actedAt: new Date('2026-09-28T00:00:00Z'),
    note: null,
    picChanged: false,
    picFromId: null,
    picToId: null,
    ...overrides,
  };
}

export function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return { id: 'admin-1', name: 'Dewi Partnership', ...overrides };
}

export function programOfInquiry(overrides: Partial<ProgramOfInquiry> = {}): ProgramOfInquiry {
  return {
    id: 'program-1',
    slug: 'klinik-keliling-pesisir',
    title: 'Klinik Keliling Pesisir',
    sector: 'HEALTH',
    ...overrides,
  };
}

export function proposalRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'doc-1',
    partnershipInquiryId: 'inquiry-1',
    label: 'Proposal kolaborasi',
    contentType: 'application/pdf',
    sizeBytes: 1234,
    uploadedAt: new Date('2026-09-27T00:00:00Z'),
    checklistItemId: null,
    ...overrides,
  };
}

type Where = Record<string, unknown>;
type Select = Record<string, boolean | { select: Select }>;
type OrderBy = Record<string, 'asc' | 'desc'>[];

/**
 * Evaluates the slice of a Prisma `where` these reads use: plain equality
 * (null included) and `{ in: [...] }`, which is how the list asks for the
 * history of exactly the Inquiries it is showing.
 */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    const actual = row[key];
    if (value !== null && typeof value === 'object' && 'in' in (value as Record<string, unknown>)) {
      const allowed = (value as { in: unknown[] }).in;
      return allowed.includes(actual);
    }
    return actual === value;
  });
}

/** Sorts rows by a Prisma `orderBy` list, keeping insertion order for ties. */
function ordered<T>(rows: T[], orderBy?: OrderBy): T[] {
  if (!orderBy) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const clause of orderBy) {
        const [field, direction] = Object.entries(clause)[0];
        const sign = direction === 'desc' ? -1 : 1;
        const x = (a.row as Record<string, unknown>)[field] as string;
        const y = (b.row as Record<string, unknown>)[field] as string;
        if (x !== y) return x < y ? -sign : sign;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

export function makeInquiryDb(
  seed: {
    inquiries?: InquiryRow[];
    changes?: InquiryChangeRow[];
    users?: UserRow[];
    /** Users that hold the ADMIN assignment; defaults to every seeded user. */
    adminIds?: string[];
    documents?: DocumentRow[];
    /**
     * Runs at the start of every `updateMany`, the place a second admin's
     * already-committed move can be simulated: the caller is about to write
     * against what it read, and the row is no longer there.
     */
    onBeforeStatusWrite?: () => void;
  } = {},
) {
  const inquiries = (seed.inquiries ?? []).map((row) => ({ ...row }));
  const changes = (seed.changes ?? []).map((row) => ({ ...row }));
  const users = (seed.users ?? [userRow()]).map((row) => ({ ...row }));
  const adminIds = seed.adminIds ?? users.map((u) => u.id);
  const documents = (seed.documents ?? []).map((row) => ({ ...row }));
  const program = programOfInquiry();

  const userById = (id: unknown): UserRow | null => users.find((u) => u.id === id) ?? null;

  /** Resolves a nested relation select against the seeded rows. */
  const relations = (row: Record<string, unknown>): Record<string, unknown> => ({
    program: { ...program },
    pic: userById(row.picId),
    actedBy: userById(row.actedById),
    picFrom: userById(row.picFromId),
    picTo: userById(row.picToId),
  });

  /** Applies a Prisma `select` (nested relations included) to a row. */
  function shape(row: Record<string, unknown>, select?: Select): Record<string, unknown> {
    if (!select) return { ...row };
    const related = relations(row);
    return Object.fromEntries(
      Object.entries(select)
        .filter(([, wanted]) => wanted)
        .map(([key, wanted]) => {
          if (typeof wanted === 'object') {
            const target = related[key] as Record<string, unknown> | null | undefined;
            if (target === undefined) throw new Error(`The fake knows no relation "${key}"`);
            return [key, target === null ? null : shape(target, wanted.select)];
          }
          return [key, row[key]];
        }),
    );
  }

  const refuseSelectWithInclude = (args: { select?: unknown; include?: unknown }) => {
    if (args.select && args.include) {
      throw new Error('Please either use `include` or `select`, but not both at the same time.');
    }
  };

  const prisma = {
    partnershipInquiry: {
      findMany: async (
        args: { where?: Where; orderBy?: OrderBy; select?: Select; include?: unknown } = {},
      ) => {
        refuseSelectWithInclude(args);
        const rows = ordered(inquiries.filter((row) => matches(row, args.where ?? {})), args.orderBy);
        return rows.map((row) => shape(row, args.select));
      },
      findUnique: async (args: { where: Where; select?: Select; include?: unknown }) => {
        refuseSelectWithInclude(args);
        const row = inquiries.find((candidate) => matches(candidate, args.where));
        return row ? shape(row, args.select) : null;
      },
      // Predicated, like the real write: a caller that read a state someone
      // else has already moved writes nothing and is told so.
      updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        seed.onBeforeStatusWrite?.();
        const written = inquiries.filter((row) => matches(row, where));
        for (const row of written) {
          Object.assign(row, data, { updatedAt: new Date() });
        }
        return { count: written.length };
      },
    },
    partnershipInquiryStatusChange: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `change-${changes.length + 1}`,
          note: null,
          picChanged: false,
          picFromId: null,
          picToId: null,
          ...data,
        } as InquiryChangeRow;
        changes.push(row);
        return { ...row };
      },
      findMany: async (args: { where?: Where; orderBy?: OrderBy; select?: Select; include?: unknown } = {}) => {
        refuseSelectWithInclude(args);
        const rows = ordered(changes.filter((row) => matches(row, args.where ?? {})), args.orderBy);
        return rows.map((row) => shape(row as unknown as Record<string, unknown>, args.select));
      },
    },
    userAssignment: {
      findUnique: async ({ where }: { where: { userId_assignment: { userId: string; assignment: string } } }) => {
        const { userId, assignment } = where.userId_assignment;
        return assignment === 'ADMIN' && adminIds.includes(userId) ? { userId, assignment } : null;
      },
      findMany: async ({ where }: { where: { assignment: string } }) =>
        where.assignment === 'ADMIN' ? adminIds.map((id) => ({ user: userById(id) })).filter((r) => r.user) : [],
    },
    document: {
      findMany: async (args: { where?: Where; orderBy?: OrderBy; select?: Select } = {}) =>
        ordered(documents.filter((row) => matches(row, args.where ?? {})), args.orderBy).map((row) =>
          shape(row as unknown as Record<string, unknown>, args.select),
        ),
    },
    $transaction: async (run: (tx: unknown) => unknown) => run(prisma),
  };

  return {
    prisma,
    get inquiries() {
      return inquiries;
    },
    get changes() {
      return changes;
    },
    get users() {
      return users;
    },
  };
}
