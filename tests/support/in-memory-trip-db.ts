import type {
  StatusChangeCapacity,
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
 * nothing. `beforeNextRowLock` models a competitor that held the Trip row
 * lock and committed first: the only schedule Postgres allows against an
 * operation that locks before it reads.
 *
 * Kept apart from the Campaign stand-in because a Trip is not a Campaign
 * (ADR 0014). Later tickets add Batch, Registration and Payment here.
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

type Data = {
  trips: TripRow[];
  statusChanges: TripStatusChangeRow[];
  notifications: TripNotificationRow[];
};

type Where = Record<string, unknown>;

/** Plain equality and `in`; anything else throws rather than over-match. */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, filter]) => {
    if (filter === undefined) return true;
    if (filter !== null && typeof filter === 'object') {
      const { in: list, ...rest } = filter as { in?: unknown[] };
      if (Object.keys(rest).length > 0 || !list) {
        throw new Error(`in-memory trip db does not understand the filter on ${key}`);
      }
      return list.includes(row[key]);
    }
    return row[key] === filter;
  });
}

function clone(data: Data): Data {
  return {
    trips: data.trips.map((t) => ({ ...t })),
    statusChanges: data.statusChanges.map((s) => ({ ...s })),
    notifications: data.notifications.map((n) => ({ ...n })),
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

export function makeTripDb(seed: { trips?: TripRow[] } = {}) {
  let committed: Data = {
    trips: (seed.trips ?? []).map((t) => ({ ...t })),
    statusChanges: [],
    notifications: [],
  };
  const rowLocks: string[] = [];
  let pendingLockInterleave: ((data: Data) => void) | null = null;
  let nextId = 1;

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
      volunteerTripStatusChange: {
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
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        const table = /FROM "(\w+)" WHERE id = \? FOR UPDATE/.exec(sql)?.[1];
        if (!table) throw new Error(`in-memory trip db does not understand: ${sql}`);
        if (pendingLockInterleave) {
          const interleave = pendingLockInterleave;
          pendingLockInterleave = null;
          interleave(committed);
          // The competitor committed while we waited; every read after the
          // lock sees it, as READ COMMITTED does in Postgres.
          Object.assign(getData(), clone(committed));
        }
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
    get statusChanges() {
      return committed.statusChanges;
    },
    get notifications() {
      return committed.notifications;
    },
    /** Every row lock taken, committed or not, as "<Table>:<id>". */
    get rowLocks() {
      return rowLocks;
    },
    /** Simulate another request committing while we wait for the next row lock. */
    beforeNextRowLock(interleave: (data: Data) => void) {
      pendingLockInterleave = interleave;
    },
  };
}
