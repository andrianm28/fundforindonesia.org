import type { CampaignStatus, Kind } from '@/generated/prisma/client';

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
 * writers and the legacy `status` column never mistake it for application
 * code. Later lifecycle tickets extend it with the models they add.
 */

export type CampaignRow = {
  id: string;
  slug: string;
  title: string;
  creatorId: string;
  lifecycleStatus: CampaignStatus;
  isUrgent: boolean;
  deadline: Date | null;
  /** Optional so the lifecycle tests need not name it; the list readers filter on it. */
  category?: string;
  kind: Kind;
  /** The Partner Organisation it collects under; `partner-1` unless a test says otherwise. */
  collectingEntityId: string | null;
};

export type PartnerOrganisationRow = {
  id: string;
  name: string;
  fundraiserId: string;
  acceptsIndividualCampaigns: boolean;
  registeredById: string;
  registeredAt: Date;
};

export type FundraisingPermitRow = {
  id: string;
  partnerOrganisationId: string;
  number: string;
  issuer: string;
  kinds: Kind[];
  validFrom: Date;
  validTo: Date;
  recordedById: string;
  recordedAt: Date;
};

export type PartnerOrganisationAuditRow = {
  id: string;
  partnerOrganisationId: string;
  permitId: string | null;
  action: 'REGISTERED' | 'UPDATED' | 'PERMIT_RECORDED' | 'PERMIT_UPDATED';
  before: unknown;
  after: unknown;
  actedById: string;
  actedAt: Date;
};


/** The slice of a User the lifecycle reads: who a Fundraiser is, to write to them. */
export type UserRow = {
  id: string;
  email: string;
  name: string;
};

export function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return { id: 'creator-1', email: 'creator-1@example.test', name: 'Siti Fundraiser', ...overrides };
}

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

export type ChecklistItemRow = {
  id: string;
  label: string;
  required: boolean;
  position: number;
  active: boolean;
};

export type VerificationRequestRow = {
  id: string;
  campaignId: string;
  submittedById: string;
  submittedAt: Date;
  checklist: unknown;
  outcome: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  reason: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  isFirst: boolean;
  collectingEntityId?: string | null;
};

export type ChecklistAuditRow = {
  id: string;
  itemId: string;
  action: 'CREATED' | 'UPDATED';
  before: unknown;
  after: unknown;
  actedById: string;
  actedAt: Date;
};

export type IdentityVerificationRow = {
  id: string;
  userId: string;
  verifierId: string;
  verifiedAt: Date;
  note: string | null;
};

/** Every table the stand-in holds; what the interleave hooks receive. */
export type CampaignDbData = Data;

type Data = {
  campaigns: CampaignRow[];
  statusChanges: StatusChangeRow[];
  notifications: NotificationRow[];
  campaignUpdates: CampaignUpdateRow[];
  cancellationRequests: CancellationRequestRow[];
  payouts: PayoutRow[];
  campaignFlags: CampaignFlagRow[];
  checklistItems: ChecklistItemRow[];
  checklistAudits: ChecklistAuditRow[];
  verificationRequests: VerificationRequestRow[];
  identityVerifications: IdentityVerificationRow[];
  partnerOrganisations: PartnerOrganisationRow[];
  fundraisingPermits: FundraisingPermitRow[];
  partnerOrganisationAudits: PartnerOrganisationAuditRow[];
};

type Where = Record<string, unknown>;

/**
 * Evaluates the slice of a Prisma `where` the Campaign readers use: plain
 * equality (null included), AND / OR / NOT, and the `in`, `gt`, `gte`, `lt`,
 * `lte` and `contains` (with `mode: 'insensitive'`) filters. Anything else
 * throws, so a reader never silently matches more than Postgres would.
 */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'AND') return asList(value).every((w) => matches(row, w));
    if (key === 'OR') return asList(value).some((w) => matches(row, w));
    if (key === 'NOT') return !asList(value).some((w) => matches(row, w));
    return matchesField(row[key], value);
  });
}

function asList(value: unknown): Where[] {
  return (Array.isArray(value) ? value : [value]) as Where[];
}

function comparable(value: unknown): number | string {
  return value instanceof Date ? value.getTime() : (value as number | string);
}

function matchesField(actual: unknown, filter: unknown): boolean {
  if (filter === null || typeof filter !== 'object' || filter instanceof Date) {
    return comparable(actual) === comparable(filter) || actual === filter;
  }
  const { mode, ...ops } = filter as Record<string, unknown>;
  return Object.entries(ops).every(([op, operand]) => {
    if (operand === undefined) return true;
    switch (op) {
      case 'equals':
        return matchesField(actual, operand);
      case 'in':
        return (operand as unknown[]).includes(actual);
      case 'gt':
        return actual !== null && actual !== undefined && comparable(actual) > comparable(operand);
      case 'gte':
        return actual !== null && actual !== undefined && comparable(actual) >= comparable(operand);
      case 'lt':
        return actual !== null && actual !== undefined && comparable(actual) < comparable(operand);
      case 'lte':
        return actual !== null && actual !== undefined && comparable(actual) <= comparable(operand);
      case 'contains': {
        if (typeof actual !== 'string') return false;
        return mode === 'insensitive'
          ? actual.toLowerCase().includes(String(operand).toLowerCase())
          : actual.includes(String(operand));
      }
      default:
        throw new Error(`in-memory db does not understand the filter ${op}`);
    }
  });
}

/** Evaluates a Campaign `where` against one row, as the list readers' tests need. */
export function campaignMatches(row: CampaignRow, where: Where): boolean {
  return matches(row, where);
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
    checklistItems: data.checklistItems.map((i) => ({ ...i })),
    checklistAudits: data.checklistAudits.map((a) => ({ ...a })),
    verificationRequests: data.verificationRequests.map((r) => ({ ...r })),
    identityVerifications: data.identityVerifications.map((v) => ({ ...v })),
    partnerOrganisations: data.partnerOrganisations.map((o) => ({ ...o })),
    fundraisingPermits: data.fundraisingPermits.map((p) => ({ ...p, kinds: [...p.kinds] })),
    partnerOrganisationAudits: data.partnerOrganisationAudits.map((a) => ({ ...a })),
  };
}

/**
 * The Partner Organisation every default Campaign collects under: linked to
 * `partner-fundraiser-1`, accepting individual Campaigns.
 */
export function partnerOrganisationRow(overrides: Partial<PartnerOrganisationRow> = {}): PartnerOrganisationRow {
  return {
    id: 'partner-1',
    name: 'Yayasan Contoh Peduli',
    fundraiserId: 'partner-fundraiser-1',
    acceptsIndividualCampaigns: true,
    registeredById: 'verifier-1',
    registeredAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** A permit of `partner-1` covering every Kind from 2020 through 2099. */
export function fundraisingPermitRow(overrides: Partial<FundraisingPermitRow> = {}): FundraisingPermitRow {
  return {
    id: 'permit-1',
    partnerOrganisationId: 'partner-1',
    number: '001/PUB/2026',
    issuer: 'Kementerian Sosial',
    kinds: ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'],
    validFrom: new Date('2020-01-01T00:00:00Z'),
    validTo: new Date('2099-12-31T23:59:59Z'),
    recordedById: 'verifier-1',
    recordedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Applies a Prisma `select` or `include` to a Campaign row, joining its
 * Collecting Entity with its permits when asked for, as
 * COLLECTING_ENTITY_SELECT reads it.
 */
function shapeCampaign(
  data: Data,
  row: CampaignRow,
  shape: { select?: Record<string, unknown>; include?: Record<string, unknown> },
): Record<string, unknown> {
  const joined = (): Record<string, unknown> | null => {
    const entity = data.partnerOrganisations.find((o) => o.id === row.collectingEntityId);
    if (!entity) return null;
    return {
      ...entity,
      permits: data.fundraisingPermits
        .filter((p) => p.partnerOrganisationId === entity.id)
        .map((p) => ({ ...p, kinds: [...p.kinds] })),
    };
  };
  if (shape.select) {
    return Object.fromEntries(
      Object.keys(shape.select)
        .filter((key) => shape.select![key])
        .map((key) => [key, key === 'collectingEntity' ? joined() : row[key as keyof CampaignRow]]),
    );
  }
  if (shape.include?.collectingEntity) return { ...row, collectingEntity: joined() };
  return { ...row };
}

export function checklistItemRow(overrides: Partial<ChecklistItemRow> = {}): ChecklistItemRow {
  return {
    id: 'item-1',
    label: 'Rencana anggaran',
    required: true,
    position: 1,
    active: true,
    ...overrides,
  };
}

export function verificationRequestRow(
  overrides: Partial<VerificationRequestRow> = {},
): VerificationRequestRow {
  return {
    id: 'verification-1',
    campaignId: 'campaign-1',
    submittedById: 'creator-1',
    submittedAt: new Date('2026-09-24T08:00:00Z'),
    checklist: [],
    outcome: 'PENDING',
    reason: null,
    decidedById: null,
    decidedAt: null,
    isFirst: true,
    ...overrides,
  };
}

/** Sorts rows by a single-field Prisma `orderBy`, keeping insertion order for ties. */
function ordered<T>(rows: T[], orderBy?: Record<string, 'asc' | 'desc'>): T[] {
  if (!orderBy) return rows;
  const [[field, direction]] = Object.entries(orderBy);
  const sign = direction === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = comparable((a.row as Record<string, unknown>)[field]);
      const y = comparable((b.row as Record<string, unknown>)[field]);
      return (x < y ? -sign : x > y ? sign : 0) || a.index - b.index;
    })
    .map(({ row }) => row);
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
    lifecycleStatus: 'SUBMITTED',
    isUrgent: false,
    deadline: null,
    kind: 'DONATION',
    collectingEntityId: 'partner-1',
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
    checklistItems?: ChecklistItemRow[];
    verificationRequests?: VerificationRequestRow[];
    identityVerifications?: IdentityVerificationRow[];
    /** Defaults to `partner-1` alone, so a default Campaign has a Collecting Entity. */
    partnerOrganisations?: PartnerOrganisationRow[];
    /** Defaults to `permit-1` alone, covering every Kind until 2099. */
    fundraisingPermits?: FundraisingPermitRow[];
    /** Read-only, so kept outside the transactional copy; defaults to the Fundraiser of campaignRow(). */
    users?: UserRow[];
  } = {},
) {
  const users = (seed.users ?? [userRow()]).map((u) => ({ ...u }));
  let committed: Data = {
    campaigns: (seed.campaigns ?? []).map((c) => ({ ...c })),
    statusChanges: (seed.statusChanges ?? []).map((s) => ({ ...s })),
    notifications: [],
    campaignUpdates: (seed.campaignUpdates ?? []).map((u) => ({ ...u })),
    cancellationRequests: (seed.cancellationRequests ?? []).map((r) => ({ ...r })),
    payouts: (seed.payouts ?? []).map((p) => ({ ...p })),
    campaignFlags: (seed.campaignFlags ?? []).map((f) => ({ ...f })),
    checklistItems: (seed.checklistItems ?? []).map((i) => ({ ...i })),
    checklistAudits: [],
    verificationRequests: (seed.verificationRequests ?? []).map((r) => ({ ...r })),
    identityVerifications: (seed.identityVerifications ?? []).map((v) => ({ ...v })),
    partnerOrganisations: (seed.partnerOrganisations ?? [partnerOrganisationRow()]).map((o) => ({ ...o })),
    fundraisingPermits: (seed.fundraisingPermits ?? [fundraisingPermitRow()]).map((p) => ({ ...p, kinds: [...p.kinds] })),
    partnerOrganisationAudits: [],
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
  // Only a writer without the Campaign row lock can meet this schedule in
  // Postgres (lazy expiry); a lifecycle command holds the lock from before
  // its read, so model its competitors with beforeNextRowLock instead.
  let pendingInterleave: ((data: Data) => void) | null = null;

  function client(getData: () => Data) {
    return {
      campaign: {
        findUnique: async ({ where, select, include }: { where: Where; select?: Record<string, unknown>; include?: Record<string, unknown> }) => {
          const row = getData().campaigns.find((c) => matches(c, where));
          return row ? shapeCampaign(getData(), row, { select, include }) : null;
        },
        // What the public list readers call. Order is insertion order; the
        // readers' tests assert on which Campaigns come back, not the order.
        findMany: async ({ where = {}, skip = 0, take, select, omit }: { where?: Where; skip?: number; take?: number; select?: Record<string, boolean>; omit?: Record<string, boolean> }) => {
          const rows = getData().campaigns.filter((c) => matches(c, where));
          const page = rows.slice(skip, take === undefined ? undefined : skip + take);
          if (omit) {
            return page.map((row) =>
              Object.fromEntries(Object.entries(row).filter(([key]) => !omit[key])),
            );
          }
          if (!select) return page.map((row) => ({ ...row }));
          return page.map((row) =>
            Object.fromEntries(
              Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key as keyof CampaignRow]]),
            ),
          );
        },
        count: async ({ where = {} }: { where?: Where } = {}) =>
          getData().campaigns.filter((c) => matches(c, where)).length,
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
        // A write to the row the caller holds locked. No competitor can
        // commit in between, so it does not consult beforeNextCampaignWrite.
        update: async ({ where, data }: { where: { id: string }; data: Partial<CampaignRow> }) => {
          const row = getData().campaigns.find((c) => c.id === where.id);
          if (!row) throw new Error('No Campaign found');
          Object.assign(row, data);
          return { ...row };
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
        create: async ({ data }: { data: Pick<CancellationRequestRow, 'campaignId' | 'requestedById' | 'reason'> & { createdAt?: Date } }) => {
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
        update: async ({ where, data }: { where: Where; data: Partial<CancellationRequestRow> }) => {
          const row = getData().cancellationRequests.find((r) => matches(r, where));
          if (!row) throw new Error('No CancellationRequest found');
          Object.assign(row, data);
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
        create: async ({ data }: { data: Pick<CampaignFlagRow, 'campaignId' | 'verifierId' | 'reason'> & { createdAt?: Date } }) => {
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
        update: async ({ where, data }: { where: Where; data: Partial<CampaignFlagRow> }) => {
          const row = getData().campaignFlags.find((f) => matches(f, where));
          if (!row) throw new Error('No CampaignFlag found');
          Object.assign(row, data);
          return { ...row };
        },
        updateMany: async ({ where, data }: { where: Where; data: Partial<CampaignFlagRow> }) => {
          const rows = getData().campaignFlags.filter((f) => matches(f, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      verificationChecklistItem: {
        findMany: async ({ where = {}, orderBy }: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'> } = {}) =>
          ordered(getData().checklistItems.filter((i) => matches(i, where)), orderBy).map((i) => ({ ...i })),
        findUnique: async ({ where }: { where: Where }) => {
          const row = getData().checklistItems.find((i) => matches(i, where));
          return row ? { ...row } : null;
        },
        create: async ({ data }: { data: Omit<ChecklistItemRow, 'id' | 'active'> & { active?: boolean } }) => {
          const row: ChecklistItemRow = { id: `item-${nextId++}`, active: true, ...data };
          getData().checklistItems.push(row);
          return { ...row };
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<ChecklistItemRow> }) => {
          const row = getData().checklistItems.find((i) => i.id === where.id);
          if (!row) throw new Error('No VerificationChecklistItem found');
          Object.assign(row, data);
          return { ...row };
        },
      },
      verificationChecklistAuditEntry: {
        create: async ({ data }: { data: Omit<ChecklistAuditRow, 'id' | 'actedAt' | 'before'> & { before?: unknown; actedAt?: Date } }) => {
          // An omitted (or undefined) `before` is SQL NULL, as Prisma writes it.
          const row: ChecklistAuditRow = { id: `audit-${nextId++}`, actedAt: new Date(), ...data, before: data.before ?? null };
          getData().checklistAudits.push(row);
          return { ...row };
        },
      },
      verificationRequest: {
        create: async ({ data }: { data: Pick<VerificationRequestRow, 'campaignId' | 'submittedById' | 'checklist' | 'isFirst' | 'collectingEntityId'> & { submittedAt?: Date } }) => {
          const row: VerificationRequestRow = {
            id: `verification-${nextId++}`,
            submittedAt: new Date(),
            outcome: 'PENDING',
            reason: null,
            decidedById: null,
            decidedAt: null,
            ...data,
          };
          getData().verificationRequests.push(row);
          return { ...row };
        },
        // `include: { campaign }` joins the request's Campaign row, as the
        // Verifier queue reads it; any nested include is the caller's to fill.
        findMany: async ({ where = {}, orderBy, include }: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'>; include?: { campaign?: unknown } } = {}) =>
          ordered(getData().verificationRequests.filter((r) => matches(r, where)), orderBy).map((r) => {
            if (!include?.campaign) return { ...r };
            const campaign = getData().campaigns.find((c) => c.id === r.campaignId);
            return { ...r, campaign: campaign ? { ...campaign } : null };
          }),
        findUnique: async ({ where }: { where: Where }) => {
          const row = getData().verificationRequests.find((r) => matches(r, where));
          return row ? { ...row } : null;
        },
        count: async ({ where = {} }: { where?: Where } = {}) =>
          getData().verificationRequests.filter((r) => matches(r, where)).length,
        updateMany: async ({ where, data }: { where: Where; data: Partial<VerificationRequestRow> }) => {
          const rows = getData().verificationRequests.filter((r) => matches(r, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      identityVerification: {
        // `skipDuplicates` is ON CONFLICT DO NOTHING on the unique userId.
        createMany: async ({ data, skipDuplicates }: { data: Omit<IdentityVerificationRow, 'id'>[]; skipDuplicates?: boolean }) => {
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
      partnerOrganisation: {
        findUnique: async ({ where, include }: { where: Where; include?: { permits?: unknown } }) => {
          const row = getData().partnerOrganisations.find((o) => matches(o, where));
          if (!row) return null;
          if (!include?.permits) return { ...row };
          return {
            ...row,
            permits: getData().fundraisingPermits
              .filter((p) => p.partnerOrganisationId === row.id)
              .map((p) => ({ ...p, kinds: [...p.kinds] })),
          };
        },
        findMany: async ({ where = {}, orderBy }: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'>; select?: unknown; include?: unknown } = {}) =>
          ordered(getData().partnerOrganisations.filter((o) => matches(o, where)), orderBy).map((o) => ({ ...o })),
        create: async ({ data }: { data: Omit<PartnerOrganisationRow, 'id' | 'registeredAt'> & { registeredAt?: Date } }) => {
          if (getData().partnerOrganisations.some((o) => o.fundraiserId === data.fundraiserId)) {
            throw new Error('Unique constraint failed on PartnerOrganisation.fundraiserId');
          }
          const row: PartnerOrganisationRow = { id: `partner-${nextId++}`, registeredAt: new Date(), ...data };
          getData().partnerOrganisations.push(row);
          return { ...row };
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<PartnerOrganisationRow> }) => {
          const row = getData().partnerOrganisations.find((o) => o.id === where.id);
          if (!row) throw new Error('No PartnerOrganisation found');
          Object.assign(row, data);
          return { ...row };
        },
      },
      fundraisingPermit: {
        findUnique: async ({ where }: { where: Where }) => {
          const row = getData().fundraisingPermits.find((p) => matches(p, where));
          return row ? { ...row, kinds: [...row.kinds] } : null;
        },
        create: async ({ data }: { data: Omit<FundraisingPermitRow, 'id' | 'recordedAt'> & { recordedAt?: Date } }) => {
          const row: FundraisingPermitRow = { id: `permit-${nextId++}`, recordedAt: new Date(), ...data, kinds: [...data.kinds] };
          getData().fundraisingPermits.push(row);
          return { ...row, kinds: [...row.kinds] };
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<FundraisingPermitRow> }) => {
          const row = getData().fundraisingPermits.find((p) => p.id === where.id);
          if (!row) throw new Error('No FundraisingPermit found');
          Object.assign(row, data);
          return { ...row, kinds: [...row.kinds] };
        },
      },
      partnerOrganisationAuditEntry: {
        create: async ({ data }: { data: Omit<PartnerOrganisationAuditRow, 'id' | 'actedAt' | 'before' | 'permitId'> & { before?: unknown; permitId?: string | null; actedAt?: Date } }) => {
          const row: PartnerOrganisationAuditRow = {
            id: `partner-audit-${nextId++}`,
            actedAt: new Date(),
            ...data,
            permitId: data.permitId ?? null,
            before: data.before ?? null,
          };
          getData().partnerOrganisationAudits.push(row);
          return { ...row };
        },
      },
      user: {
        findUnique: async ({ where }: { where: Where }) => {
          const row = users.find((u) => matches(u, where));
          return row ? { ...row } : null;
        },
        findUniqueOrThrow: async ({ where }: { where: Where }) => {
          const row = users.find((u) => matches(u, where));
          if (!row) throw new Error('No User found');
          return { ...row };
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
          // after the lock sees it, rows it changed and rows it added, as
          // READ COMMITTED does in Postgres. Every lifecycle command takes
          // this lock before its first read or write, so there is nothing
          // of our own in the working copy for this to overwrite.
          Object.assign(getData(), clone(committed));
        }
        rowLocks.push(`${table}:${String(values[0])}`);
        return [{ id: values[0] }];
      },
      // Only `LOCK TABLE "<Table>" IN SHARE ROW EXCLUSIVE MODE`, recorded as
      // "<Table>:*". The stand-in runs one command at a time, so the lock
      // itself has nothing to serialise; taking it is what is observable.
      $executeRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        const table = /^LOCK TABLE "(\w+)" IN SHARE ROW EXCLUSIVE MODE$/.exec(sql)?.[1];
        if (!table) throw new Error(`in-memory db does not understand: ${sql}`);
        rowLocks.push(`${table}:*`);
        return 0;
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
    get verificationRequests() {
      return committed.verificationRequests;
    },
    get checklistItems() {
      return committed.checklistItems;
    },
    get checklistAudits() {
      return committed.checklistAudits;
    },
    get identityVerifications() {
      return committed.identityVerifications;
    },
    get partnerOrganisations() {
      return committed.partnerOrganisations;
    },
    get fundraisingPermits() {
      return committed.fundraisingPermits;
    },
    get partnerOrganisationAudits() {
      return committed.partnerOrganisationAudits;
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
    /**
     * Simulate another request committing a change just before our next
     * predicated Campaign write (`updateMany`). A plain `update` of a locked
     * row does not consult it, since no competitor can commit inside the lock.
     */
    beforeNextCampaignWrite(interleave: (data: Data) => void) {
      pendingInterleave = interleave;
    },
    /** Simulate another request committing while we wait for the next row lock. */
    beforeNextRowLock(interleave: (data: Data) => void) {
      pendingLockInterleave = interleave;
    },
  };
}
