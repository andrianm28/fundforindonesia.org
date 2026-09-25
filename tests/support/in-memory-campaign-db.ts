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

type Data = {
  campaigns: CampaignRow[];
  statusChanges: StatusChangeRow[];
  notifications: NotificationRow[];
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
  seed: { campaigns?: CampaignRow[]; statusChanges?: StatusChangeRow[] } = {},
) {
  let committed: Data = {
    campaigns: (seed.campaigns ?? []).map((c) => ({ ...c })),
    statusChanges: (seed.statusChanges ?? []).map((s) => ({ ...s })),
    notifications: [],
  };
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
        // Newest first by createdAt; among equal timestamps the row written
        // last wins, which is what a caller asking for "the latest" means.
        findFirst: async ({ where, orderBy }: { where: Where; orderBy?: { createdAt: 'asc' | 'desc' } }) => {
          const rows = getData().statusChanges.filter((s) => matches(s, where));
          const direction = orderBy?.createdAt === 'asc' ? 1 : -1;
          const sorted = rows
            .map((row, index) => ({ row, index }))
            .sort((a, b) => direction * (a.row.createdAt.getTime() - b.row.createdAt.getTime() || a.index - b.index));
          return sorted.length > 0 ? { ...sorted[0].row } : null;
        },
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
    campaign(id = 'campaign-1') {
      const row = committed.campaigns.find((c) => c.id === id);
      if (!row) throw new Error(`no campaign ${id}`);
      return row;
    },
    /** Simulate another request committing a change just before our next Campaign write. */
    beforeNextCampaignWrite(interleave: (data: Data) => void) {
      pendingInterleave = interleave;
    },
  };
}
