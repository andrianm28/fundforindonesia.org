import type {
  PaymentStatus,
  RefundStatus,
  RegistrationStatus,
  StatusChangeCapacity,
  VolunteerBatchStatus,
  VolunteerTripStatus,
  VolunteerTripStatusChangeAction,
} from '@/generated/prisma/client';

/**
 * In-memory stand-in for the slice of PrismaClient that the Volunteer Trip
 * operations module (src/lib/volunteer/trip.ts) touches, in the style of
 * ./in-memory-campaign-db.ts: the real module runs against it, and tests
 * assert on the rows it leaves behind rather than on which methods ran.
 *
 * `$transaction` runs the callback against a copy of the data, committed
 * only if the callback resolves, so a refused operation visibly writes
 * nothing. `beforeNextRowLock` models a competitor that held the next row
 * lock and committed first: the only schedule Postgres allows against an
 * operation that locks before it reads.
 *
 * Holds Trips, their Batches, Registrations and Trip Fee Payments, and the
 * Refunds and ledger rows the real `createRefund` (src/lib/money/refunds.ts)
 * writes, so Batch cancel runs end to end. Every row lock is recorded, in
 * the order taken, as "<Table>:<id>" in `rowLocks`; that log is how tests
 * pin the module's lock order.
 *
 * Kept apart from the Campaign stand-in because a Trip is not a Campaign
 * (ADR 0014).
 */

export type TripRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  story: string;
  coverImage: string;
  destination: string;
  itinerary: string;
  tripFeeAmount: number;
  status: VolunteerTripStatus;
  fundraiserId: string;
};

export type TripStatusChangeRow = {
  id: string;
  tripId: string;
  action: VolunteerTripStatusChangeAction;
  fromStatus: VolunteerTripStatus;
  toStatus: VolunteerTripStatus;
  actorId: string | null;
  capacity: StatusChangeCapacity;
  reason: string | null;
  createdAt: Date;
};

export type TripNotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  userId: string;
  link: string | null;
};

export type BatchRow = {
  id: string;
  tripId: string;
  startDate: Date;
  endDate: Date;
  registrationDeadline: Date;
  maxQuota: number;
  minQuota: number;
  status: VolunteerBatchStatus;
};

export type RegistrationRow = {
  id: string;
  volunteerId: string;
  batchId: string;
  status: RegistrationStatus;
  holdExpiresAt: Date;
  /** Set once, by completeBatch (ticket 35); false until then. */
  attended: boolean;
};

/** A Trip Fee Payment: always a Registration's, never a Donation's. */
export type PaymentRow = {
  id: string;
  registrationId: string;
  amount: number;
  providerFee: number;
  status: PaymentStatus;
  escrowReleasedAt: Date | null;
};

export type RefundRow = {
  id: string;
  paymentId: string;
  amount: number;
  reason: string;
  requestedById: string;
  status: RefundStatus;
  createdAt: Date;
};

export type LedgerEntryRow = {
  account: string;
  direction: string;
  amount: number;
  volunteerTripId: string | null;
  refundId: string | null;
  transactionId: string;
};

/** A Verifier's one-time identity check of a Fundraiser; `userId` is unique, as in the schema. */
export type IdentityVerificationRow = {
  id: string;
  userId: string;
  verifierId: string;
  verifiedAt: Date;
  note: string | null;
};

/** Only what the Sertifikat Keikutsertaan copies: a person's display name. */
export type UserRow = { id: string; name: string };

/** A Sertifikat Keikutsertaan; `registrationId` and `code` are unique, as in the schema. */
export type CertificateRow = {
  id: string;
  registrationId: string;
  code: string;
  volunteerName: string;
  tripTitle: string;
  destination: string;
  batchStartDate: Date;
  batchEndDate: Date;
  organizerName: string;
  issuedAt: Date;
};

type Data = {
  users: UserRow[];
  certificates: CertificateRow[];
  trips: TripRow[];
  statusChanges: TripStatusChangeRow[];
  notifications: TripNotificationRow[];
  batches: BatchRow[];
  registrations: RegistrationRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  ledgerEntries: LedgerEntryRow[];
  identityVerifications: IdentityVerificationRow[];
};

/** The tables `SELECT id FROM "<Table>" WHERE id = ... FOR UPDATE` may name. */
const LOCKABLE: Record<string, 'trips' | 'batches' | 'registrations' | 'payments'> = {
  VolunteerTrip: 'trips',
  VolunteerBatch: 'batches',
  Registration: 'registrations',
  Payment: 'payments',
};

/** The one multi-row lock: a Batch's live (HOLD or CONFIRMED) Registrations. */
const LIVE_REGISTRATIONS_LOCK =
  /^SELECT id, status FROM "Registration" WHERE "batchId" = \? AND status IN \('HOLD', 'CONFIRMED'\) ORDER BY id FOR UPDATE$/;

type Where = Record<string, unknown>;

/** Plain equality, `in`, `notIn` and a Date `lte`; anything else throws rather than over-match. */
function matches(row: object, where: Where): boolean {
  const fields = row as Record<string, unknown>;
  return Object.entries(where).every(([key, filter]) => {
    if (filter === undefined) return true;
    if (filter !== null && typeof filter === 'object' && !(filter instanceof Date)) {
      const { in: list, notIn, lte, ...rest } = filter as { in?: unknown[]; notIn?: unknown[]; lte?: Date };
      if (Object.keys(rest).length > 0 || (!list && !notIn && !lte)) {
        throw new Error(`in-memory trip db does not understand the filter on ${key}`);
      }
      if (list && !list.includes(fields[key])) return false;
      if (notIn && notIn.includes(fields[key])) return false;
      if (lte && !(fields[key] instanceof Date && fields[key].getTime() <= lte.getTime())) return false;
      return true;
    }
    return fields[key] === filter;
  });
}

function clone(data: Data): Data {
  return {
    users: data.users.map((u) => ({ ...u })),
    certificates: data.certificates.map((c) => ({ ...c })),
    trips: data.trips.map((t) => ({ ...t })),
    statusChanges: data.statusChanges.map((s) => ({ ...s })),
    notifications: data.notifications.map((n) => ({ ...n })),
    batches: data.batches.map((b) => ({ ...b })),
    registrations: data.registrations.map((r) => ({ ...r })),
    payments: data.payments.map((p) => ({ ...p })),
    refunds: data.refunds.map((r) => ({ ...r })),
    ledgerEntries: data.ledgerEntries.map((e) => ({ ...e })),
    identityVerifications: data.identityVerifications.map((v) => ({ ...v })),
  };
}

export function tripRow(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: 'trip-1',
    slug: 'mengajar-di-pulau-terpencil',
    title: 'Mengajar di Pulau Terpencil',
    description: 'Seminggu mengajar anak-anak di pulau terluar.',
    story: 'Cerita perjalanan.',
    coverImage: 'https://example.com/cover.jpg',
    destination: 'Pulau Sebatik',
    itinerary: 'Hari 1: tiba. Hari 2-6: mengajar. Hari 7: pulang.',
    tripFeeAmount: 2_500_000,
    status: 'DRAFT',
    fundraiserId: 'fundraiser-1',
    ...overrides,
  };
}

export function batchRow(overrides: Partial<BatchRow> = {}): BatchRow {
  return {
    id: 'batch-1',
    tripId: 'trip-1',
    startDate: new Date('2026-12-01T00:00:00Z'),
    endDate: new Date('2026-12-07T00:00:00Z'),
    registrationDeadline: new Date('2026-11-20T00:00:00Z'),
    maxQuota: 20,
    minQuota: 8,
    status: 'OPEN',
    ...overrides,
  };
}

export function registrationRow(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: 'registration-1',
    volunteerId: 'volunteer-1',
    batchId: 'batch-1',
    status: 'CONFIRMED',
    holdExpiresAt: new Date('2026-10-01T00:00:00Z'),
    attended: false,
    ...overrides,
  };
}

export function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'payment-1',
    registrationId: 'registration-1',
    amount: 2_500_000,
    providerFee: 0,
    status: 'PAID',
    escrowReleasedAt: null,
    ...overrides,
  };
}

type Seed = {
  users?: UserRow[];
  trips?: TripRow[];
  batches?: BatchRow[];
  registrations?: RegistrationRow[];
  payments?: PaymentRow[];
  identityVerifications?: IdentityVerificationRow[];
};

export function makeTripDb(seed: Seed = {}) {
  let committed: Data = {
    users: (seed.users ?? []).map((u) => ({ ...u })),
    certificates: [],
    trips: (seed.trips ?? []).map((t) => ({ ...t })),
    statusChanges: [],
    notifications: [],
    batches: (seed.batches ?? []).map((b) => ({ ...b })),
    registrations: (seed.registrations ?? []).map((r) => ({ ...r })),
    payments: (seed.payments ?? []).map((p) => ({ ...p })),
    refunds: [],
    ledgerEntries: [],
    identityVerifications: (seed.identityVerifications ?? []).map((v) => ({ ...v })),
  };
  const rowLocks: string[] = [];
  let pendingLockInterleave: ((data: Data) => void) | null = null;
  let nextId = 1;

  function paymentOf(data: Data, registrationId: string) {
    const payment = data.payments.find((p) => p.registrationId === registrationId);
    return payment ? { ...payment } : null;
  }

  function client(getData: () => Data) {
    return {
      volunteerTrip: {
        findUnique: async ({ where }: { where: Where }) => {
          const row = getData().trips.find((t) => matches(t, where));
          return row ? { ...row } : null;
        },
        findUniqueOrThrow: async ({ where }: { where: Where }) => {
          const row = getData().trips.find((t) => matches(t, where));
          if (!row) throw new Error('No VolunteerTrip found');
          return { ...row };
        },
        updateMany: async ({ where, data }: { where: Where; data: Partial<TripRow> }) => {
          const rows = getData().trips.filter((t) => matches(t, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      user: {
        findMany: async ({ where }: { where: Where }) =>
          getData()
            .users.filter((u) => matches(u, where))
            .map((u) => ({ ...u })),
      },
      volunteerCertificate: {
        findMany: async ({ where }: { where: Where }) =>
          getData()
            .certificates.filter((c) => matches(c, where))
            .map((c) => ({ ...c })),
        // `skipDuplicates` is ON CONFLICT DO NOTHING on either unique column.
        createMany: async ({
          data,
          skipDuplicates,
        }: {
          data: Array<Omit<CertificateRow, 'id' | 'issuedAt'> & { issuedAt?: Date }>;
          skipDuplicates?: boolean;
        }) => {
          let count = 0;
          for (const input of data) {
            const clash = getData().certificates.some(
              (c) => c.registrationId === input.registrationId || c.code === input.code,
            );
            if (clash) {
              if (skipDuplicates) continue;
              throw new Error('Unique constraint failed on VolunteerCertificate');
            }
            getData().certificates.push({ id: `certificate-${nextId++}`, issuedAt: new Date(), ...input });
            count += 1;
          }
          return { count };
        },
      },
      volunteerTripStatusChange: {
        // The newest row matching `where`, as liftTripSuspension reads the Suspension it undoes.
        findFirst: async ({ where }: { where: Where; orderBy?: unknown }) => {
          const rows = getData()
            .statusChanges.filter((c) => matches(c, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
          return rows[0] ? { ...rows[0] } : null;
        },
        create: async ({
          data,
        }: {
          data: Omit<TripStatusChangeRow, 'id' | 'createdAt' | 'reason'> & { reason?: string | null; createdAt?: Date };
        }) => {
          const row: TripStatusChangeRow = { id: `change-${nextId++}`, reason: null, createdAt: new Date(), ...data };
          getData().statusChanges.push(row);
          return { ...row };
        },
      },
      notification: {
        create: async ({ data }: { data: Omit<TripNotificationRow, 'id' | 'link'> & { link?: string | null } }) => {
          const row: TripNotificationRow = { id: `notification-${nextId++}`, link: null, ...data };
          getData().notifications.push(row);
          return { ...row };
        },
      },
      identityVerification: {
        // `skipDuplicates` is ON CONFLICT DO NOTHING on the unique userId.
        createMany: async ({
          data,
          skipDuplicates,
        }: {
          data: Omit<IdentityVerificationRow, 'id'>[];
          skipDuplicates?: boolean;
        }) => {
          let count = 0;
          for (const input of data) {
            if (getData().identityVerifications.some((v) => v.userId === input.userId)) {
              if (skipDuplicates) continue;
              throw new Error('Unique constraint failed on IdentityVerification.userId');
            }
            getData().identityVerifications.push({ id: `identity-${nextId++}`, ...input });
            count += 1;
          }
          return { count };
        },
      },
      volunteerBatch: {
        create: async ({ data }: { data: Omit<BatchRow, 'id' | 'status'> & { status?: VolunteerBatchStatus } }) => {
          const row: BatchRow = { id: `batch-${nextId++}`, status: 'OPEN', ...data };
          getData().batches.push(row);
          return { ...row };
        },
        findUnique: async ({ where }: { where: Where }) => {
          const row = getData().batches.find((b) => matches(b, where));
          return row ? { ...row } : null;
        },
        findUniqueOrThrow: async ({ where }: { where: Where }) => {
          const row = getData().batches.find((b) => matches(b, where));
          if (!row) throw new Error('No VolunteerBatch found');
          return { ...row };
        },
        updateMany: async ({ where, data }: { where: Where; data: Partial<BatchRow> }) => {
          const rows = getData().batches.filter((b) => matches(b, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      registration: {
        count: async ({ where }: { where: Where }) => getData().registrations.filter((r) => matches(r, where)).length,
        findFirst: async ({ where }: { where: Where }) => {
          const row = getData().registrations.find((r) => matches(r, where));
          return row ? { ...row } : null;
        },
        // With the batch and payment includes Registration cancel asks for.
        findUnique: async ({ where, include }: { where: Where; include?: { batch?: boolean; payment?: boolean } }) => {
          const data = getData();
          const row = data.registrations.find((r) => matches(r, where));
          if (!row) return null;
          const batch = data.batches.find((b) => b.id === row.batchId)!;
          return {
            ...row,
            ...(include?.batch ? { batch: { ...batch } } : {}),
            ...(include?.payment ? { payment: paymentOf(data, row.id) } : {}),
          };
        },
        create: async ({ data }: { data: Omit<RegistrationRow, 'id' | 'attended'> }) => {
          const row: RegistrationRow = { id: `registration-${nextId++}`, attended: false, ...data };
          getData().registrations.push(row);
          return { ...row };
        },
        findMany: async ({ where, include }: { where: Where; include?: { payment?: boolean } }) =>
          getData()
            .registrations.filter((r) => matches(r, where))
            .map((r) => ({ ...r, ...(include?.payment ? { payment: paymentOf(getData(), r.id) } : {}) })),
        updateMany: async ({ where, data }: { where: Where; data: Partial<RegistrationRow> }) => {
          const rows = getData().registrations.filter((r) => matches(r, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      payment: {
        // The one include createRefund asks for: whose the Payment is.
        findUniqueOrThrow: async ({ where }: { where: Where }) => {
          const data = getData();
          const payment = data.payments.find((p) => matches(p, where));
          if (!payment) throw new Error('No Payment found');
          const registration = data.registrations.find((r) => r.id === payment.registrationId)!;
          const batch = data.batches.find((b) => b.id === registration.batchId)!;
          return { ...payment, donation: null, registration: { ...registration, batch: { ...batch } } };
        },
      },
      refund: {
        findMany: async ({ where }: { where: Where }) =>
          getData()
            .refunds.filter((r) => matches(r, where))
            .map((r) => ({ ...r })),
        create: async ({ data }: { data: Omit<RefundRow, 'id' | 'createdAt'> }) => {
          const row: RefundRow = { id: `refund-${nextId++}`, createdAt: new Date(), ...data };
          getData().refunds.push(row);
          return { ...row };
        },
      },
      ledgerEntry: {
        count: async ({ where }: { where: Where }) => getData().ledgerEntries.filter((e) => matches(e, where)).length,
        createMany: async ({ data }: { data: LedgerEntryRow[] }) => {
          getData().ledgerEntries.push(...data.map((e) => ({ ...e })));
          return { count: data.length };
        },
      },
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?').replace(/\s+/g, ' ').trim();
        const scopedBatch = /^SELECT id FROM "VolunteerBatch" WHERE id = \? AND "tripId" = \? FOR UPDATE$/.test(sql);
        const table = scopedBatch ? 'VolunteerBatch' : /FROM "(\w+)" WHERE id = \? FOR UPDATE$/.exec(sql)?.[1];
        const liveRegistrations = LIVE_REGISTRATIONS_LOCK.test(sql);
        if (!(table && LOCKABLE[table]) && !liveRegistrations) {
          throw new Error(`in-memory trip db does not understand: ${sql}`);
        }
        if (pendingLockInterleave) {
          const interleave = pendingLockInterleave;
          pendingLockInterleave = null;
          interleave(committed);
          // The competitor committed while we waited; every read after the
          // lock sees it, as READ COMMITTED does in Postgres.
          Object.assign(getData(), clone(committed));
        }
        const data = getData();
        if (liveRegistrations) {
          const locked = data.registrations
            .filter((r) => r.batchId === values[0] && (r.status === 'HOLD' || r.status === 'CONFIRMED'))
            .sort((a, b) => a.id.localeCompare(b.id));
          for (const r of locked) rowLocks.push(`Registration:${r.id}`);
          return locked.map((r) => ({ id: r.id, status: r.status }));
        }
        const rows: Array<{ id: string; tripId?: string }> = data[LOCKABLE[table!]];
        const found = rows.some((row) => row.id === values[0] && (!scopedBatch || row.tripId === values[1]));
        if (!found) return [];
        rowLocks.push(`${table}:${String(values[0])}`);
        return [{ id: values[0] }];
      },
    };
  }

  const prisma = {
    ...client(() => committed),
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      const working = clone(committed);
      const result = await callback(client(() => working));
      committed = working;
      return result;
    },
  };

  return {
    prisma,
    /** Committed rows only: what a later request would see. */
    trip(id = 'trip-1') {
      const row = committed.trips.find((t) => t.id === id);
      if (!row) throw new Error(`no trip ${id}`);
      return row;
    },
    batch(id = 'batch-1') {
      const row = committed.batches.find((b) => b.id === id);
      if (!row) throw new Error(`no batch ${id}`);
      return row;
    },
    get batches() {
      return committed.batches;
    },
    get registrations() {
      return committed.registrations;
    },
    get refunds() {
      return committed.refunds;
    },
    get ledgerEntries() {
      return committed.ledgerEntries;
    },
    get users() {
      return committed.users;
    },
    get certificates() {
      return committed.certificates;
    },
    get statusChanges() {
      return committed.statusChanges;
    },
    get notifications() {
      return committed.notifications;
    },
    get identityVerifications() {
      return committed.identityVerifications;
    },
    /** Every row lock taken, committed or not, as "<Table>:<id>", in order. */
    get rowLocks() {
      return rowLocks;
    },
    /** Simulate another request committing while we wait for the next row lock. */
    beforeNextRowLock(interleave: (data: Data) => void) {
      pendingLockInterleave = interleave;
    },
  };
}
