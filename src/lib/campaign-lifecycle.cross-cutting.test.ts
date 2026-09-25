import { describe, it, expect } from 'vitest';
import {
  completeCampaign,
  decideCancellation,
  decideSubmission,
  dismissFlag,
  flagCampaign,
  liftSuspension,
  requestCancellation,
  setUrgent,
  suspendCampaign,
  CampaignNotFoundError,
  CancellationAlreadyPendingError,
  CancellationNotPendingError,
  FlagAlreadyResolvedError,
  InvalidTransitionError,
  LifecycleValidationError,
  NotAuthorizedError,
  OwnCampaignConflictError,
  type LifecycleActor,
} from './campaign-lifecycle';
import {
  campaignFlagRow,
  campaignRow,
  cancellationRequestRow,
  makeCampaignDb,
  type CampaignFlagRow,
  type CampaignRow,
  type CancellationRequestRow,
  type StatusChangeRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * The cases every lifecycle command shares, run once per command through its
 * exported interface: not found, missing assignment, reason validation, the
 * own-Campaign rule, lazy expiry that survives a refusal, and a competing
 * write committed while the command waited for the Campaign row lock. Each
 * per-command test file keeps only that command's own rules.
 */
const NOW = new Date('2026-09-25T10:00:00Z');
const PAST = new Date('2026-09-20T00:00:00Z');
const REASON = 'Alasan yang cukup jelas.';

const verifier: LifecycleActor = { userId: 'verifier-1', assignments: ['VERIFIER'] };
const admin: LifecycleActor = { userId: 'admin-1', assignments: ['ADMIN'] };
const nobody: LifecycleActor = { userId: 'someone-1', assignments: [] };
const owner: LifecycleActor = { userId: 'creator-1', assignments: [] };
/** The Campaign's own Fundraiser, holding every operator assignment. */
const ownerOperator: LifecycleActor = { userId: 'creator-1', assignments: ['VERIFIER', 'ADMIN'] };

type Db = ReturnType<typeof makeCampaignDb>;
type Seed = NonNullable<Parameters<typeof makeCampaignDb>[0]>;
type Params = { campaignId?: string; actor?: LifecycleActor; reason?: unknown };
type ErrorClass = abstract new (...args: never[]) => Error;
/** What a competing request may change before our lock is granted. */
type Committed = {
  campaigns: CampaignRow[];
  statusChanges: StatusChangeRow[];
  cancellationRequests: CancellationRequestRow[];
  campaignFlags: CampaignFlagRow[];
};

type CommandCase = {
  /** Builds the rows on which `actor` succeeds; `campaign` overrides the Campaign. */
  seed: (campaign?: Partial<CampaignRow>) => Seed;
  run: (db: Db, params: Params) => Promise<unknown>;
  actor: LifecycleActor;
  /** People who may not run the command at all. */
  unauthorized: LifecycleActor[];
  takesReason: boolean;
  /** The role the own-Campaign rule names, where it applies. */
  ownCampaignRole?: 'Admin' | 'Verifier';
  /** Once lazy expiry has run, the command is refused like this (run as `actor` unless given). */
  refusedOnceExpired: { actor?: LifecycleActor; error: ErrorClass };
  /** Another request that commits while this one waits for the lock, and how this one loses. */
  competitor: (data: Committed) => void;
  losesWith: ErrorClass;
};

function reasonOf(params: Params) {
  return 'reason' in params ? params.reason : REASON;
}

function active(overrides: Partial<CampaignRow> = {}) {
  return campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', ...overrides });
}

const COMMANDS: Record<string, CommandCase> = {
  decideSubmission: {
    seed: (campaign) => ({ campaigns: [campaignRow(campaign)] }),
    run: (db, p) =>
      decideSubmission(db.prisma as never, {
        campaignId: p.campaignId ?? 'campaign-1',
        actor: p.actor ?? verifier,
        decision: 'approve',
        now: NOW,
      }),
    actor: verifier,
    unauthorized: [admin, nobody],
    takesReason: false,
    ownCampaignRole: 'Verifier',
    refusedOnceExpired: { error: InvalidTransitionError },
    competitor: (data) => {
      Object.assign(data.campaigns[0], { status: 'rejected', lifecycleStatus: 'REJECTED' });
    },
    losesWith: InvalidTransitionError,
  },
  completeCampaign: {
    seed: (campaign) => ({
      campaigns: [active(campaign)],
      campaignUpdates: [{ id: 'update-1', campaignId: 'campaign-1' }],
    }),
    run: (db, p) =>
      completeCampaign(db.prisma as never, {
        campaignId: p.campaignId ?? 'campaign-1',
        actor: p.actor ?? admin,
        reason: reasonOf(p),
        now: NOW,
      }),
    actor: admin,
    unauthorized: [verifier, nobody],
    takesReason: true,
    refusedOnceExpired: { error: InvalidTransitionError },
    competitor: (data) => {
      Object.assign(data.campaigns[0], { status: 'completed', lifecycleStatus: 'COMPLETED' });
    },
    losesWith: InvalidTransitionError,
  },
  requestCancellation: {
    seed: (campaign) => ({ campaigns: [active(campaign)] }),
    run: (db, p) =>
      requestCancellation(db.prisma as never, {
        campaignId: p.campaignId ?? 'campaign-1',
        actor: p.actor ?? owner,
        reason: reasonOf(p),
        now: NOW,
      }),
    actor: owner,
    unauthorized: [admin, verifier, nobody],
    takesReason: true,
    refusedOnceExpired: { error: InvalidTransitionError },
    competitor: (data) => {
      data.cancellationRequests.push(cancellationRequestRow({ id: 'request-other' }));
    },
    losesWith: CancellationAlreadyPendingError,
  },
  decideCancellation: {
    seed: (campaign) => ({ campaigns: [active(campaign)], cancellationRequests: [cancellationRequestRow()] }),
    run: (db, p) =>
      decideCancellation(db.prisma as never, {
        campaignId: p.campaignId ?? 'campaign-1',
        requestId: 'request-1',
        actor: p.actor ?? admin,
        decision: 'approve',
        reason: reasonOf(p),
        now: NOW,
      }),
    actor: admin,
    unauthorized: [verifier, nobody],
    takesReason: true,
    ownCampaignRole: 'Admin',
    refusedOnceExpired: { error: CancellationNotPendingError },
    competitor: (data) => {
      Object.assign(data.campaigns[0], { status: 'cancelled', lifecycleStatus: 'CANCELLED' });
      Object.assign(data.cancellationRequests[0], { status: 'APPROVED', decidedById: 'admin-2' });
    },
    losesWith: CancellationNotPendingError,
  },
  suspendCampaign: {
    seed: (campaign) => ({ campaigns: [active(campaign)] }),
    run: (db, p) =>
      suspendCampaign(db.prisma as never, {
        campaignId: p.campaignId ?? 'campaign-1',
        actor: p.actor ?? admin,
        reason: reasonOf(p),
        now: NOW,
      }),
    actor: admin,
    unauthorized: [verifier, nobody],
    takesReason: true,
    ownCampaignRole: 'Admin',
    // An Expired Campaign can be suspended, so the refusal comes from the owner.
    refusedOnceExpired: { actor: ownerOperator, error: OwnCampaignConflictError },
    competitor: (data) => {
      Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
    },
    losesWith: InvalidTransitionError,
  },
  liftSuspension: {
    seed: (campaign) => ({
      campaigns: [campaignRow({ status: 'suspended', lifecycleStatus: 'SUSPENDED', ...campaign })],
      statusChanges: [
        {
          id: 'suspension-1', campaignId: 'campaign-1', action: 'SUSPENDED', fromStatus: 'ACTIVE',
          toStatus: 'SUSPENDED', actorId: 'admin-2', capacity: 'ADMIN', reason: 'Laporan penipuan',
          createdAt: new Date('2026-09-21T00:00:00Z'),
        },
      ],
    }),
    run: (db, p) =>
      liftSuspension(db.prisma as never, {
        campaignId: p.campaignId ?? 'campaign-1',
        actor: p.actor ?? admin,
        reason: reasonOf(p),
        now: NOW,
      }),
    actor: admin,
    unauthorized: [verifier, nobody],
    takesReason: true,
    ownCampaignRole: 'Admin',
    refusedOnceExpired: { error: InvalidTransitionError },
    competitor: (data) => {
      Object.assign(data.campaigns[0], { status: 'active', lifecycleStatus: 'ACTIVE' });
    },
    losesWith: InvalidTransitionError,
  },
  setUrgent: {
    seed: (campaign) => ({ campaigns: [active(campaign)] }),
    run: (db, p) =>
      setUrgent(db.prisma as never, {
        campaignId: p.campaignId ?? 'campaign-1',
        actor: p.actor ?? admin,
        urgent: true,
        reason: reasonOf(p),
        now: NOW,
      }),
    actor: admin,
    unauthorized: [verifier, nobody, owner],
    takesReason: true,
    ownCampaignRole: 'Admin',
    refusedOnceExpired: { error: InvalidTransitionError },
    competitor: (data) => {
      Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
    },
    losesWith: InvalidTransitionError,
  },
  flagCampaign: {
    seed: (campaign) => ({ campaigns: [active(campaign)] }),
    run: (db, p) =>
      flagCampaign(db.prisma as never, {
        campaignId: p.campaignId ?? 'campaign-1',
        actor: p.actor ?? verifier,
        reason: reasonOf(p),
        now: NOW,
      }),
    actor: verifier,
    unauthorized: [admin, nobody],
    takesReason: true,
    ownCampaignRole: 'Verifier',
    // An Expired Campaign can be flagged, so the refusal comes from the owner.
    refusedOnceExpired: { actor: ownerOperator, error: OwnCampaignConflictError },
    competitor: (data) => {
      Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
    },
    losesWith: InvalidTransitionError,
  },
  dismissFlag: {
    seed: (campaign) => ({ campaigns: [active(campaign)], campaignFlags: [campaignFlagRow()] }),
    run: (db, p) =>
      dismissFlag(db.prisma as never, {
        campaignId: p.campaignId ?? 'campaign-1',
        flagId: 'flag-1',
        actor: p.actor ?? admin,
        reason: reasonOf(p),
        now: NOW,
      }),
    actor: admin,
    unauthorized: [verifier, nobody],
    takesReason: true,
    ownCampaignRole: 'Admin',
    // Dismissal ignores the status, so the refusal comes from the owner.
    refusedOnceExpired: { actor: ownerOperator, error: OwnCampaignConflictError },
    competitor: (data) => {
      Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
      Object.assign(data.campaignFlags[0], {
        resolution: 'SUSPENDED', resolvedById: 'admin-2', resolutionReason: 'Penipuan', resolvedAt: NOW,
      });
    },
    losesWith: FlagAlreadyResolvedError,
  },
};

/** Every committed row a command could write. */
function snapshot(db: Db) {
  return structuredClone({
    campaigns: db.campaigns,
    statusChanges: db.statusChanges,
    notifications: db.notifications,
    cancellationRequests: db.cancellationRequests,
    campaignFlags: db.campaignFlags,
  });
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the command to be refused');
    },
    (error: unknown) => error,
  );
}

describe.each(Object.entries(COMMANDS))('%s', (_name, command) => {
  it('succeeds for its actor, locking the Campaign row once and stamping every log row with its now', async () => {
    const db = makeCampaignDb(command.seed());

    await command.run(db, { actor: command.actor });

    expect(db.rowLocks).toEqual(['Campaign:campaign-1']);
    for (const change of db.statusChanges.filter((c) => c.id !== 'suspension-1')) {
      expect(change.createdAt).toEqual(NOW);
    }
  });

  it('refuses an unknown Campaign with CampaignNotFoundError and writes nothing', async () => {
    const db = makeCampaignDb(command.seed());
    const before = snapshot(db);

    const error = await refusal(command.run(db, { campaignId: 'missing' }));

    expect(error).toBeInstanceOf(CampaignNotFoundError);
    expect(error).toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
    expect(snapshot(db)).toEqual(before);
  });

  it.each(command.unauthorized.map((actor) => [actor.userId, actor] as const))(
    'refuses %s, who may not run it, with NotAuthorizedError and writes nothing',
    async (_userId, actor) => {
      const db = makeCampaignDb(command.seed());
      const before = snapshot(db);

      const error = await refusal(command.run(db, { actor }));

      expect(error).toBeInstanceOf(NotAuthorizedError);
      expect(snapshot(db)).toEqual(before);
    },
  );

  it('records a Campaign past its deadline Expired at its now, and keeps that when the command is refused', async () => {
    const db = makeCampaignDb(command.seed({ status: 'active', lifecycleStatus: 'ACTIVE', deadline: PAST }));

    const error = await refusal(command.run(db, { actor: command.refusedOnceExpired.actor ?? command.actor }));

    expect(error).toBeInstanceOf(command.refusedOnceExpired.error);
    expect(db.campaign()).toMatchObject({ status: 'expired', lifecycleStatus: 'EXPIRED' });
    expect(db.statusChanges.filter((c) => c.id !== 'suspension-1')).toEqual([
      expect.objectContaining({
        action: 'EXPIRED',
        fromStatus: 'ACTIVE',
        toStatus: 'EXPIRED',
        actorId: null,
        capacity: 'SYSTEM',
        createdAt: NOW,
      }),
    ]);
  });

  it('judges what a competing request committed before the lock was granted, and writes nothing of its own', async () => {
    const db = makeCampaignDb(command.seed());
    const expected = makeCampaignDb(command.seed());
    command.competitor(expected);
    db.beforeNextRowLock((data) => command.competitor(data));

    const error = await refusal(command.run(db, {}));

    expect(error).toBeInstanceOf(command.losesWith);
    expect(db.rowLocks).toEqual(['Campaign:campaign-1']);
    expect(snapshot(db)).toEqual(snapshot(expected));
  });
});

const TAKING_A_REASON = Object.entries(COMMANDS).filter(([, command]) => command.takesReason);
const WITH_OWN_CAMPAIGN_RULE = Object.entries(COMMANDS).filter(([, command]) => command.ownCampaignRole);

describe.each(TAKING_A_REASON)('%s reason', (_name, command) => {
  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['not text', 42],
    ['longer than 1000 characters', 'a'.repeat(1001)],
  ])('refuses a %s reason with LifecycleValidationError on the reason field and writes nothing', async (_label, reason) => {
    const db = makeCampaignDb(command.seed());
    const before = snapshot(db);

    const error = await refusal(command.run(db, { reason }));

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(error).toMatchObject({ field: 'reason' });
    expect(snapshot(db)).toEqual(before);
  });
});

describe.each(WITH_OWN_CAMPAIGN_RULE)('%s on its own Campaign', (_name, command) => {
  it('refuses its owner, even holding every assignment, with OwnCampaignConflictError and writes nothing', async () => {
    const db = makeCampaignDb(command.seed());
    const before = snapshot(db);

    const error = await refusal(command.run(db, { actor: ownerOperator }));

    expect(error).toBeInstanceOf(OwnCampaignConflictError);
    expect((error as Error).message).toContain(`${command.ownCampaignRole} lain`);
    expect(snapshot(db)).toEqual(before);
  });
});

describe.each(WITH_OWN_CAMPAIGN_RULE.filter(([, command]) => command.takesReason))(
  '%s on its own Campaign with a blank reason',
  (_name, command) => {
    it('is refused for the reason before the owner: 400, not 403', async () => {
      const db = makeCampaignDb(command.seed());

      const error = await refusal(command.run(db, { actor: ownerOperator, reason: ' ' }));

      expect(error).toBeInstanceOf(LifecycleValidationError);
    });
  },
);
