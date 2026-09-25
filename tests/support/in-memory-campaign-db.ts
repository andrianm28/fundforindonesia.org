import type { CampaignStatus } from '@/generated/prisma/client';

/**
 * In-memory stand-in for the slice of PrismaClient that the Campaign
 * lifecycle module (src/lib/campaign-lifecycle.ts) touches, in the style of
 * the Payout service tests: the real module runs against it, and tests
 * assert on the rows it leaves behind rather than on which methods were
 * called.
 *
 * `$transaction` is real enough to matter: the callback runs against a
 * copy of the data, which is committed only if the callback resolves. A
 * throw discards every write the callback made, so "this write survives a
 * refused command" is observable, not assumed.
 *
 * Lives outside src/ so the static guards that scan src/ for Campaign
 * writers and `lifecycleStatus` readers never mistake it for application
 * code. Later lifecycle tickets extend it with the models they add.
 */

export type CampaignRow = {
  id: string;
  slug: string;
  title: string;
  creatorId: string;
  status: string;
  lifecycleStatus: CampaignStatus;
  isUrgent: boolean;
  deadline: Date | null;
};

export type StatusChangeRow = {
  id: string;
  campaignId: string;
  action: string;
  fromStatus: CampaignStatus | null;
  toStatus: CampaignStatus | null;
  actorId: string | null;
  capacity: string;
  reason: string | null;
  createdAt: Date;
};

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  userId: string;
  link: string | null;
};

export type CampaignUpdateRow = {
  id: string;
  campaignId: string;
};

export type CancellationRequestRow = {
  id: string;
  campaignId: string;
  requestedById: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  decidedById: string | null;
  decisionReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

export type CampaignFlagRow = {
  id: string;
  campaignId: string;
  verifierId: string;
  reason: string;
  createdAt: Date;
  resolution: 'SUSPENDED' | 'DISMISSED' | null;
  resolvedById: string | null;
  resolutionReason: string | null;
  resolvedAt: Date | null;
};

/** Only what the lifecycle module reads of a Payout: its Campaign and status. */
export type PayoutRow = {
  id: string;
  campaignId: string | null;
  status: string;
};

type Data = {
  campaigns: CampaignRow[];
  statusChanges: StatusChangeRow[];
  notifications: NotificationRow[];
  campaignUpdates: CampaignUpdateRow[];
  cancellationRequests: CancellationRequestRow[];
  payouts: PayoutRow[];
  campaignFlags: CampaignFlagRow[];
};

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function clone(data: Data): Data {
  return {
    campaigns: data.campaigns.map((c) => ({ ...c })),
    statusChanges: data.statusChanges.map((s) => ({ ...s })),
    notifications: data.notifications.map((n) => ({ ...n })),
    campaignUpdates: data.campaignUpdates.map((u) => ({ ...u })),
    cancellationRequests: data.cancellationRequests.map((r) => ({ ...r })),
    payouts: data.payouts.map((p) => ({ ...p })),
    campaignFlags: data.campaignFlags.map((f) => ({ ...f })),
  };
}

export function cancellationRequestRow(
  overrides: Partial<CancellationRequestRow> = {},
): CancellationRequestRow {
  return {
    id: 'request-1',
    campaignId: 'campaign-1',
    requestedById: 'creator-1',
    reason: 'Pasien sudah sembuh sebelum dana terkumpul.',
    status: 'PENDING',
    decidedById: null,
    decisionReason: null,
    createdAt: new Date('2026-09-24T08:00:00Z'),
    decidedAt: null,
    ...overrides,
  };
}

export function campaignFlagRow(overrides: Partial<CampaignFlagRow> = {}): CampaignFlagRow {
  return {
    id: 'flag-1',
    campaignId: 'campaign-1',
    verifierId: 'verifier-1',
    reason: 'Foto pasien diambil dari berita lama.',
    createdAt: new Date('2026-09-24T08:00:00Z'),
    resolution: null,
    resolvedById: null,
    resolutionReason: null,
    resolvedAt: null,
    ...overrides,
  };
}

export function campaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: 'campaign-1',
    slug: 'bantu-korban-banjir',
    title: 'Bantu Korban Banjir',
    creatorId: 'creator-1',
    status: 'pending',
    lifecycleStatus: 'SUBMITTED',
    isUrgent: false,
    deadline: null,
    ...overrides,
  };
}

export function makeCampaignDb(
  seed: {
    campaigns?: CampaignRow[];
    statusChanges?: StatusChangeRow[];
    campaignUpdates?: CampaignUpdateRow[];
    cancellationRequests?: CancellationRequestRow[];
    payouts?: PayoutRow[];
    campaignFlags?: CampaignFlagRow[];
  } = {},
) {
  let committed: Data = {
    campaigns: (seed.campaigns ?? []).map((c) => ({ ...c })),
    statusChanges: (seed.statusChanges ?? []).map((s) => ({ ...s })),
    notifications: [],
    campaignUpdates: (seed.campaignUpdates ?? []).map((u) => ({ ...u })),
    cancellationRequests: (seed.cancellationRequests ?? []).map((r) => ({ ...r })),
    payouts: (seed.payouts ?? []).map((p) => ({ ...p })),
    campaignFlags: (seed.campaignFlags ?? []).map((f) => ({ ...f })),
  };
  // Row locks taken with `SELECT ... FOR UPDATE`, in order, as
  // "<Table>:<id>". Observable because taking the lock IS the behaviour
  // that serialises two Admins deciding against the same Campaign.
  const rowLocks: string[] = [];
  // Runs once, just before the next row lock is granted, against the
  // COMMITTED data: a writer that held the lock and committed first.
  let pendingLockInterleave: ((data: Data) => void) | null = null;
  let nextId = 1;
  // Runs once, immediately before the next Campaign write, against the
  // COMMITTED data: a concurrent request that committed between our read
  // and our write. Used to prove the status predicate, not to script calls.
  let pendingInterleave: ((data: Data) => void) | null = null;

  function client(getData: () => Data) {
    return {
      campaign: {
        findUnique: async ({ where }: { where: Where }) => {
          const row = getData().campaigns.find((c) => matches(c, where));
          return row ? { ...row } : null;
        },
        findUniqueOrThrow: async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
          const row = getData().campaigns.find((c) => matches(c, where));
          if (!row) throw new Error('No Campaign found');
          if (!select) return { ...row };
          return Object.fromEntries(
            Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key as keyof CampaignRow]]),
          );
        },
        updateMany: async ({ where, data }: { where: Where; data: Partial<CampaignRow> }) => {
          if (pendingInterleave) {
            const interleave = pendingInterleave;
            pendingInterleave = null;
            interleave(committed);
            // The concurrent writer committed; our working copy must see
            // it, exactly as a row-level predicate in Postgres would.
            const current = getData();
            for (const row of current.campaigns) {
              const fresh = committed.campaigns.find((c) => c.id === row.id);
              if (fresh) Object.assign(row, fresh);
            }
          }
          const rows = getData().campaigns.filter((c) => matches(c, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      campaignStatusChange: {
        create: async ({ data }: { data: Omit<StatusChangeRow, 'id' | 'createdAt' | 'reason'> & { reason?: string | null; createdAt?: Date } }) => {
          const row: StatusChangeRow = {
            id: `change-${nextId++}`,
            reason: null,
            createdAt: new Date(),
            ...data,
          };
          getData().statusChanges.push(row);
          return { ...row };
        },
        // Ordered by createdAt only. Equal timestamps fall back to insertion
        // order, which Postgres does not promise: tests that depend on "the
        // latest" row seed distinct timestamps rather than rely on this.
        findFirst: async ({ where, orderBy }: { where: Where; orderBy?: { createdAt: 'asc' | 'desc' } }) => {
          const rows = getData().statusChanges.filter((s) => matches(s, where));
          const direction = orderBy?.createdAt === 'asc' ? 1 : -1;
          const sorted = rows
            .map((row, index) => ({ row, index }))
            .sort((a, b) => direction * (a.row.createdAt.getTime() - b.row.createdAt.getTime() || a.index - b.index));
          return sorted.length > 0 ? { ...sorted[0].row } : null;
        },
      },
      campaignUpdate: {
        count: async ({ where }: { where: Where }) =>
          getData().campaignUpdates.filter((u) => matches(u, where)).length,
      },
      cancellationRequest: {
        findUnique: async ({ where }: { where: Where }) => {
          const row = getData().cancellationRequests.find((r) => matches(r, where));
          return row ? { ...row } : null;
        },
        findFirst: async ({ where }: { where: Where }) => {
          const row = getData().cancellationRequests.find((r) => matches(r, where));
          return row ? { ...row } : null;
        },
        findUniqueOrThrow: async ({ where }: { where: Where }) => {
          const row = getData().cancellationRequests.find((r) => matches(r, where));
          if (!row) throw new Error('No CancellationRequest found');
          return { ...row };
        },
        create: async ({ data }: { data: Pick<CancellationRequestRow, 'campaignId' | 'requestedById' | 'reason'> }) => {
          const row: CancellationRequestRow = {
            id: `request-${nextId++}`,
            status: 'PENDING',
            decidedById: null,
            decisionReason: null,
            createdAt: new Date(),
            decidedAt: null,
            ...data,
          };
          getData().cancellationRequests.push(row);
          return { ...row };
        },
        updateMany: async ({ where, data }: { where: Where; data: Partial<CancellationRequestRow> }) => {
          const rows = getData().cancellationRequests.filter((r) => matches(r, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      campaignFlag: {
        findUnique: async ({ where }: { where: Where }) => {
          const row = getData().campaignFlags.find((f) => matches(f, where));
          return row ? { ...row } : null;
        },
        findUniqueOrThrow: async ({ where }: { where: Where }) => {
          const row = getData().campaignFlags.find((f) => matches(f, where));
          if (!row) throw new Error('No CampaignFlag found');
          return { ...row };
        },
        create: async ({ data }: { data: Pick<CampaignFlagRow, 'campaignId' | 'verifierId' | 'reason'> }) => {
          const row: CampaignFlagRow = {
            id: `flag-${nextId++}`,
            createdAt: new Date(),
            resolution: null,
            resolvedById: null,
            resolutionReason: null,
            resolvedAt: null,
            ...data,
          };
          getData().campaignFlags.push(row);
          return { ...row };
        },
        updateMany: async ({ where, data }: { where: Where; data: Partial<CampaignFlagRow> }) => {
          const rows = getData().campaignFlags.filter((f) => matches(f, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      payout: {
        count: async ({ where }: { where: Where }) =>
          getData().payouts.filter((p) => matches(p, where)).length,
      },
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        const table = /FROM "(\w+)" WHERE id = \? FOR UPDATE/.exec(sql)?.[1];
        if (!table) throw new Error(`in-memory db does not understand: ${sql}`);
        if (pendingLockInterleave) {
          const interleave = pendingLockInterleave;
          pendingLockInterleave = null;
          interleave(committed);
          // Waiting for the lock let the other writer commit; every read
          // after the lock sees it, as READ COMMITTED does in Postgres.
          const current = getData();
          for (const row of current.campaigns) {
            const fresh = committed.campaigns.find((c) => c.id === row.id);
            if (fresh) Object.assign(row, fresh);
          }
          for (const row of current.cancellationRequests) {
            const fresh = committed.cancellationRequests.find((r) => r.id === row.id);
            if (fresh) Object.assign(row, fresh);
          }
          for (const row of current.campaignFlags) {
            const fresh = committed.campaignFlags.find((f) => f.id === row.id);
            if (fresh) Object.assign(row, fresh);
          }
        }
        rowLocks.push(`${table}:${String(values[0])}`);
        return [{ id: values[0] }];
      },
      notification: {
        create: async ({ data }: { data: Omit<NotificationRow, 'id' | 'link'> & { link?: string | null } }) => {
          const row: NotificationRow = { id: `notification-${nextId++}`, link: null, ...data };
          getData().notifications.push(row);
          return { ...row };
        },
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
    get campaigns() {
      return committed.campaigns;
    },
    get statusChanges() {
      return committed.statusChanges;
    },
    get notifications() {
      return committed.notifications;
    },
    get cancellationRequests() {
      return committed.cancellationRequests;
    },
    get campaignFlags() {
      return committed.campaignFlags;
    },
    campaignFlag(id = 'flag-1') {
      const row = committed.campaignFlags.find((f) => f.id === id);
      if (!row) throw new Error(`no campaign flag ${id}`);
      return row;
    },
    /** Every row lock taken, committed or not, as "<Table>:<id>". */
    get rowLocks() {
      return rowLocks;
    },
    cancellationRequest(id = 'request-1') {
      const row = committed.cancellationRequests.find((r) => r.id === id);
      if (!row) throw new Error(`no cancellation request ${id}`);
      return row;
    },
    campaign(id = 'campaign-1') {
      const row = committed.campaigns.find((c) => c.id === id);
      if (!row) throw new Error(`no campaign ${id}`);
      return row;
    },
    /** Simulate another request committing a change just before our next Campaign write. */
    beforeNextCampaignWrite(interleave: (data: Data) => void) {
      pendingInterleave = interleave;
    },
    /** Simulate another request committing while we wait for the next row lock. */
    beforeNextRowLock(interleave: (data: Data) => void) {
      pendingLockInterleave = interleave;
    },
  };
}
