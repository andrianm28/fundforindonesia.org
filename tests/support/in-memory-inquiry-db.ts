import type { PartnershipInquiryStatus, Sector } from '@/generated/prisma/client';

/**
 * In-memory stand-in for the slice of PrismaClient that the Partnership
 * Inquiry follow-up touches, in the style of the Program and Campaign ones:
 * the real module and route handlers run against it, and the tests assert on
 * the rows left behind and the answers returned rather than on how the query
 * was built.
 *
 * Two things here are behaviour, not convenience, so they are modelled rather
 * than stubbed:
 *
 * - `partnershipInquiry.updateMany` is PREDICATED. It writes only the rows
 *   whose `status` still equals the status the caller read, and reports how
 *   many it wrote. That is what makes two people moving the same Inquiry at
 *   once end with one refusal instead of one overwrite, so a fake that
 *   ignored the predicate would make the concurrency test prove nothing.
 * - the reads carry the relations the module asks for (`program`, and a
 *   status change's `changedBy`), so a test cannot pass by reading a shape
 *   the database would never return.
 *
 * Lives outside src/ so the static guards that scan src/ never mistake it for
 * application code.
 */

export type InquiryRow = {
  id: string;
  programId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  needs: string;
  status: PartnershipInquiryStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type InquiryChangeRow = {
  id: string;
  inquiryId: string;
  fromStatus: PartnershipInquiryStatus;
  toStatus: PartnershipInquiryStatus;
  actedById: string;
  actedAt: Date;
};

export type UserRow = { id: string; name: string };

export type ProgramOfInquiry = {
  id: string;
  slug: string;
  title: string;
  sector: Sector;
};

export function inquiryRow(overrides: Partial<InquiryRow> = {}): InquiryRow {
  return {
    id: 'inquiry-1',
    programId: 'program-1',
    companyName: 'PT Sinar Abadi',
    contactName: 'Rina Wijaya',
    contactEmail: 'rina@sinarabadi.test',
    contactPhone: '+62 812 3456 7890',
    needs: 'Kami ingin mendanai logistic dan mobilitas tim kesehatan untuk 12 bulan.',
    status: 'NOT_YET_FOLLOWED_UP',
    createdAt: new Date('2026-09-27T00:00:00Z'),
    updatedAt: new Date('2026-09-27T00:00:00Z'),
    ...overrides,
  };
}

export function inquiryChangeRow(overrides: Partial<InquiryChangeRow> = {}): InquiryChangeRow {
  return {
    id: 'change-1',
    inquiryId: 'inquiry-1',
    fromStatus: 'NOT_YET_FOLLOWED_UP',
    toStatus: 'IN_PROGRESS',
    actedById: 'admin-1',
    actedAt: new Date('2026-09-28T00:00:00Z'),
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

type Where = Record<string, unknown>;

/**
 * Evaluates the slice of a Prisma `where` these reads use: plain equality
 * (null included) and `{ in: [...] }`, which is how the follow-up list asks
 * for the status changes of exactly the Inquiries it is showing.
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
function ordered<T>(rows: T[], orderBy?: Record<string, 'asc' | 'desc'>[]): T[] {
  if (!orderBy) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const clause of orderBy) {
        const [field, direction] = Object.entries(clause)[0];
        const sign = direction === 'desc' ? -1 : 1;
        const x = (a.row as Record<string, unknown>)[field] as string;
        const y = (b.row as Record<string, unknown>)[field] as string;
        if (x !== y) return (x < y ? -sign : sign);
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Applies a Prisma `select` to a row. */
function shape(row: Record<string, unknown>, select?: Record<string, boolean>): Record<string, unknown> {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.keys(select)
      .filter((key) => select[key])
      .map((key) => [key, row[key]]),
  );
}

export function makeInquiryDb(
  seed: {
    inquiries?: InquiryRow[];
    changes?: InquiryChangeRow[];
    users?: UserRow[];
    /**
     * Runs at the start of every `updateMany`, the place a second admin's
     * already-committed move can be simulated: the caller is about to write
     * against the status it read, and the row is no longer there.
     */
    onBeforeStatusWrite?: () => void;
  } = {},
) {
  const inquiries = (seed.inquiries ?? []).map((row) => ({ ...row }));
  const changes = (seed.changes ?? []).map((row) => ({ ...row }));
  const users = (seed.users ?? [userRow()]).map((row) => ({ ...row }));
  const program = programOfInquiry();

  const nameOf = (userId: string): UserRow => {
    const found = users.find((u) => u.id === userId);
    if (!found) throw new Error(`No user ${userId}`);
    return found;
  };

  const prisma = {
    partnershipInquiry: {
      findMany: async ({
        where = {},
        orderBy,
        select,
        include,
      }: {
        where?: Where;
        orderBy?: Record<string, 'asc' | 'desc'>[];
        select?: Record<string, boolean>;
        include?: { program?: unknown };
      } = {}) => {
        const rows = ordered(inquiries.filter((row) => matches(row, where)), orderBy);
        return rows.map((row) => {
          const shaped = shape(row, select) as Record<string, unknown>;
          return include?.program ? { ...shaped, program: { ...program } } : shaped;
        });
      },
      findUnique: async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
        const row = inquiries.find((candidate) => matches(candidate, where));
        return row ? shape(row, select) : null;
      },
      // Predicated, like the real write: a caller that read a status someone
      // else has already moved writes nothing and is told so.
      updateMany: async ({ where, data }: { where: Where; data: Partial<InquiryRow> }) => {
        seed.onBeforeStatusWrite?.();
        const written = inquiries.filter((row) => matches(row, where));
        for (const row of written) {
          Object.assign(row, data, { updatedAt: new Date() });
        }
        return { count: written.length };
      },
    },
    partnershipInquiryStatusChange: {
      create: async ({ data }: { data: Omit<InquiryChangeRow, 'id'> & { id?: string } }) => {
        const row: InquiryChangeRow = { id: `change-${changes.length + 1}`, ...data };
        changes.push(row);
        return { ...row };
      },
      findMany: async ({
        where = {},
        orderBy,
        include,
      }: {
        where?: Where;
        orderBy?: Record<string, 'asc' | 'desc'>[];
        include?: { actedBy?: unknown };
      } = {}) => {
        const rows = ordered(changes.filter((row) => matches(row, where)), orderBy);
        return rows.map((row) =>
          include?.actedBy ? { ...row, actedBy: { ...nameOf(row.actedById) } } : { ...row },
        );
      },
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
