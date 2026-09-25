import {
  Assignment,
  CampaignStatus,
  CampaignStatusChangeAction,
  CancellationRequestStatus,
  FlagResolution,
  PayoutStatus,
  StatusChangeCapacity,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";

/**
 * Single source of the legacy-string to lifecycle-enum mapping.
 * Every writer that sets the `status` string sets `lifecycleStatus`
 * through this function, so the two columns cannot diverge.
 *
 * Unknown strings throw rather than map to a default: writing a
 * lifecycle state that is not one of the known legacy values
 * must fail loudly, never silently land somewhere plausible.
 */
const STRING_TO_LIFECYCLE: Record<string, CampaignStatus> = {
  pending: CampaignStatus.SUBMITTED,
  active: CampaignStatus.ACTIVE,
  rejected: CampaignStatus.REJECTED,
  suspended: CampaignStatus.SUSPENDED,
  completed: CampaignStatus.COMPLETED,
  expired: CampaignStatus.EXPIRED,
  cancelled: CampaignStatus.CANCELLED,
};

// Derived from the table above, so adding a legacy value adds both
// directions at once. DRAFT has no legacy string and stays unmapped.
const LIFECYCLE_TO_STRING = Object.fromEntries(
  Object.entries(STRING_TO_LIFECYCLE).map(([legacy, lifecycle]) => [lifecycle, legacy])
) as Partial<Record<CampaignStatus, string>>;

export function toLifecycleStatus(status: string): CampaignStatus {
  const mapped = STRING_TO_LIFECYCLE[status];
  if (!mapped) {
    throw new Error(
      `Unknown legacy campaign status: ${JSON.stringify(status)}`
    );
  }
  return mapped;
}

export function toLegacyStatus(status: CampaignStatus): string {
  const mapped = LIFECYCLE_TO_STRING[status];
  if (!mapped) {
    throw new Error(`Campaign status ${status} has no legacy string`);
  }
  return mapped;
}

/**
 * Single enforcement point for "only ACTIVE accepts a Donation".
 * POST /api/donations is the only caller. The argument is the whole
 * campaign row as selected, so the gate reads the enum that writers
 * maintain, never the legacy string. It judges the effective status, so an
 * Active Campaign past its deadline is refused before anyone has recorded
 * it Expired; the caller runs `expireIfPastDeadline` to record it.
 */
export function campaignAcceptsDonations(
  campaign: { lifecycleStatus: CampaignStatus; deadline: Date | null },
  now: Date
): boolean {
  return effectiveStatus(campaign, now) === CampaignStatus.ACTIVE;
}

// ==================== Typed errors ====================

export * from "./campaign-lifecycle-errors";
import {
  CampaignLifecycleError,
  CampaignNotFoundError,
  ConcurrentTransitionError,
  InvalidTransitionError,
  LifecycleValidationError,
  MissingCampaignUpdateError,
  NotAuthorizedError,
  OwnCampaignConflictError,
  PayoutAlreadyCompletedError,
  CancellationAlreadyPendingError,
  SameAdminLiftError,
  STATUS_LABEL,
  type OperatorCapacity,
} from "./campaign-lifecycle-errors";
import { effectiveStatus, lockAndLoad } from "./subject-guard";

// ==================== Effective status ====================

// Defined beside the row lock that reads it (./subject-guard.ts); exported
// here too, where every reader of a Campaign's status already looks.
export { effectiveStatus };

// ==================== Transitions ====================

/**
 * Who is acting. Every command takes this and decides authorization
 * itself: "owner or Admin" and "never Admin on your own Campaign" are not
 * single-assignment checks a route wrapper can express.
 */
export type LifecycleActor = {
  userId: string;
  assignments: readonly Assignment[];
};

/** The Campaign as a command leaves it; what every lifecycle route returns. */
export type CampaignState = {
  id: string;
  slug: string;
  lifecycleStatus: CampaignStatus;
  isUrgent: boolean;
};

export type LifecycleResult = { campaign: CampaignState };

type Tx = Prisma.TransactionClient;

const CAMPAIGN_STATE = {
  id: true,
  slug: true,
  lifecycleStatus: true,
  isUrgent: true,
} as const;

/**
 * The one status write. Writes both columns, predicated on the status the
 * caller judged; records the change at `now`; runs the leave-Active side
 * effects.
 *
 * The predicate matters for writers that hold no Campaign row lock: lazy
 * expiry and the scheduled expiry job (ticket 20). Under the lock every
 * command takes, it always matches.
 */
async function transition(
  tx: Tx,
  campaign: { id: string; lifecycleStatus: CampaignStatus },
  change: {
    to: CampaignStatus;
    action: CampaignStatusChangeAction;
    actorId: string | null;
    capacity: StatusChangeCapacity;
    reason?: string | null;
  },
  now: Date
): Promise<void> {
  const from = campaign.lifecycleStatus;
  const written = await tx.campaign.updateMany({
    where: { id: campaign.id, lifecycleStatus: from },
    data: { status: toLegacyStatus(change.to), lifecycleStatus: change.to },
  });
  if (written.count === 0) throw new ConcurrentTransitionError();
  await tx.campaignStatusChange.create({
    data: {
      campaignId: campaign.id,
      action: change.action,
      fromStatus: from,
      toStatus: change.to,
      actorId: change.actorId,
      capacity: change.capacity,
      reason: change.reason ?? null,
      createdAt: now,
    },
  });
  if (from === CampaignStatus.ACTIVE && change.to !== CampaignStatus.ACTIVE) {
    await leaveActive(tx, campaign.id, change.to, now);
  }
}

/**
 * Everything that must happen, in the same transaction, whenever a
 * Campaign stops being Active, whatever the exit. Urgent only means
 * something for a Campaign that can still take a Donation, so it drops
 * here and never comes back on its own (a lifted Suspension does not
 * restore it). Pending Cancellation requests lapse here too (ticket 07).
 */
async function leaveActive(
  tx: Tx,
  campaignId: string,
  to: CampaignStatus,
  now: Date
): Promise<void> {
  const cleared = await tx.campaign.updateMany({
    where: { id: campaignId, isUrgent: true },
    data: { isUrgent: false },
  });
  if (cleared.count > 0) {
    await tx.campaignStatusChange.create({
      data: {
        campaignId,
        action: CampaignStatusChangeAction.URGENT_CLEARED,
        fromStatus: null,
        toStatus: null,
        actorId: null,
        capacity: StatusChangeCapacity.SYSTEM,
        reason: `Urgent dilepas otomatis karena Campaign menjadi ${STATUS_LABEL[to]}.`,
        createdAt: now,
      },
    });
  }
  // Nobody decided it, so decidedById stays null; decidedAt says when it lapsed.
  await tx.cancellationRequest.updateMany({
    where: { campaignId, status: CancellationRequestStatus.PENDING },
    data: { status: CancellationRequestStatus.SUPERSEDED, decidedAt: now },
  });
}

/**
 * The in-app Notification to the Campaign's Fundraiser (its creator), sent
 * only when someone else made the change: a Fundraiser is never told about
 * their own action. One Notification type for every lifecycle change.
 */
async function notifyFundraiser(
  tx: Tx,
  campaign: { creatorId: string; slug: string },
  actorId: string | null,
  notification: { title: string; message: string }
): Promise<void> {
  if (actorId === campaign.creatorId) return;
  await tx.notification.create({
    data: {
      ...notification,
      type: "campaign_status",
      userId: campaign.creatorId,
      link: `/campaign/${campaign.slug}`,
    },
  });
}

/**
 * Lazy expiry: records EXPIRED (capacity SYSTEM) for a Campaign stored
 * ACTIVE whose deadline has passed, with the leave-Active side effects and a
 * notice to the Fundraiser. Returns whether it did so.
 *
 * The command runner calls this BEFORE opening a command's transaction, so
 * the expiry is committed on its own and survives the command being refused:
 * the stored status catches up with reality the moment anyone acts. The
 * scheduled expiry job (ticket 20) calls this same function.
 *
 * It takes no Campaign row lock. If another request moves the Campaign
 * first, `transition`'s predicate matches nothing, this writes nothing and
 * returns false; the command then judges whatever that request left.
 */
export async function expireIfPastDeadline(
  prisma: PrismaClient,
  campaignId: string,
  now: Date = new Date()
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (
      !campaign ||
      campaign.lifecycleStatus !== CampaignStatus.ACTIVE ||
      effectiveStatus(campaign, now) !== CampaignStatus.EXPIRED
    ) {
      return false;
    }
    try {
      await transition(
        tx,
        campaign,
        {
          to: CampaignStatus.EXPIRED,
          action: CampaignStatusChangeAction.EXPIRED,
          actorId: null,
          capacity: StatusChangeCapacity.SYSTEM,
        },
        now
      );
    } catch (error) {
      // The predicated write matched nothing, so nothing was written.
      if (error instanceof ConcurrentTransitionError) return false;
      throw error;
    }
    await notifyFundraiser(tx, campaign, null, {
      title: "Campaign Berakhir",
      message: `Tenggat Campaign "${campaign.title}" telah lewat. Campaign kini Expired dan tidak lagi menerima donasi.`,
    });
    return true;
  });
}

// ==================== Reasons and authority ====================

const REASON_MAX_LENGTH = 1000;

/** A required reason: trimmed, non-empty, at most REASON_MAX_LENGTH characters. */
function requireReason(raw: unknown): string {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason === "") {
    throw new LifecycleValidationError("Alasan wajib diisi.", "reason");
  }
  if (reason.length > REASON_MAX_LENGTH) {
    throw new LifecycleValidationError(
      `Alasan maksimal ${REASON_MAX_LENGTH} karakter.`,
      "reason"
    );
  }
  return reason;
}

/** An optional reason: absent or blank is none; anything else must pass requireReason. */
function optionalReason(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  return requireReason(raw);
}

const OPERATOR_ASSIGNMENT: Record<OperatorCapacity, Assignment> = {
  ADMIN: Assignment.ADMIN,
  VERIFIER: Assignment.VERIFIER,
};

/**
 * Who may run a command, and the capacity it is recorded in.
 * - `operator`: needs that assignment, checked before anything is read, and
 *   never acts on a Campaign they own: there they are only its Fundraiser
 *   (CONTEXT.md, Admin and Verifier; ADR 0005).
 * - `fundraiser`: only the Campaign's Fundraiser, checked once it is read.
 * - `fundraiserOrAdmin`: the owner acts as FUNDRAISER, even holding ADMIN;
 *   anyone else needs ADMIN. Checked once the Campaign is read.
 */
type Authority =
  | { kind: "operator"; capacity: OperatorCapacity; message: string }
  | { kind: "fundraiser"; message: string }
  | { kind: "fundraiserOrAdmin"; message: string };

/** The capacity the actor acts in on this Campaign, or the refusal. */
function authorize(
  authority: Authority,
  actor: LifecycleActor,
  campaign: { creatorId: string }
): StatusChangeCapacity {
  const isOwner = campaign.creatorId === actor.userId;
  switch (authority.kind) {
    case "operator":
      if (isOwner) throw new OwnCampaignConflictError(authority.capacity);
      return authority.capacity;
    case "fundraiser":
      if (!isOwner) throw new NotAuthorizedError(authority.message);
      return StatusChangeCapacity.FUNDRAISER;
    case "fundraiserOrAdmin":
      if (isOwner) return StatusChangeCapacity.FUNDRAISER;
      if (!actor.assignments.includes(Assignment.ADMIN)) {
        throw new NotAuthorizedError(authority.message);
      }
      return StatusChangeCapacity.ADMIN;
  }
}

/**
 * - `none`: the command takes no reason.
 * - `required`: validated before anything is read.
 * - `requiredUnlessFundraiser`: optional for the FUNDRAISER capacity,
 *   required otherwise; validated as soon as the capacity is known.
 */
type ReasonPolicy = "none" | "required" | "requiredUnlessFundraiser";

type ReasonFor<P extends ReasonPolicy> = P extends "required"
  ? string
  : P extends "none"
    ? null
    : string | null;

// ==================== The command runner ====================

/**
 * Serialises every command on one Campaign. Every check a command makes is
 * a read that only stays true while its transaction holds the Campaign row:
 * the status, "at most one PENDING request", "no Payout COMPLETED", "Flag
 * still open", Urgent. The same pattern the balance-touching Payout
 * operations use (src/lib/money/payouts.ts).
 *
 * The Payout guarantee is only as strong as its writer: nothing marks a
 * Payout COMPLETED yet, and the endpoint that will must take this same
 * Campaign row lock, or a Payout could complete between check and write.
 *
 * The lock is the subject guard's (./subject-guard.ts); the whole row, which
 * the steps need, is read after it, still under the lock.
 */
async function lockAndRead(tx: Tx, campaignId: string, now: Date) {
  const subject = await lockAndLoad(tx, { type: "campaign", campaignId }, now);
  if (!subject) return null;
  return tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
}

type LockedCampaign = NonNullable<Awaited<ReturnType<typeof lockAndRead>>>;

/** What a command's own step gets, once every shared check has passed. */
type StepContext<R> = {
  tx: Tx;
  /** Read under the Campaign row lock, so it stays true until commit. */
  campaign: LockedCampaign;
  /** The Campaign's effective status at `now`. */
  current: CampaignStatus;
  now: Date;
  actor: LifecycleActor;
  capacity: StatusChangeCapacity;
  reason: R;
  /** The status write, recorded with this command's actor, capacity, reason and `now`. */
  transition: (to: CampaignStatus, action: CampaignStatusChangeAction) => Promise<void>;
  /** Tells the Fundraiser, unless they are the one acting. */
  notify: (notification: { title: string; message: string }) => Promise<void>;
};

/** What every command's params carry. */
type CommandTarget = { campaignId: string; actor: LifecycleActor; now?: Date };

type CommandDeclaration<P extends ReasonPolicy, Extra> = {
  authority: Authority;
  reasonPolicy: P;
  rawReason?: unknown;
  /** Effective statuses the command runs from; left out when its step judges the status itself. */
  allowedFrom?: readonly CampaignStatus[];
  /** The command's own write. Returns what the command reports besides the Campaign. */
  step: (context: StepContext<ReasonFor<P>>) => Promise<Extra>;
};

/**
 * The sequence every lifecycle command shares, in the order a caller
 * observes it:
 *   1. the operator assignment, then the reason, before anything is read;
 *   2. lazy expiry, committed in its own transaction;
 *   3. in the command's transaction: lock the Campaign row, then read it;
 *      not found; who is acting (the own-Campaign rule, Fundraiser-only,
 *      Fundraiser-or-Admin, with a capacity-dependent reason); the allowed
 *      effective statuses; the command's step;
 *   4. the Campaign re-read, so a caller never reports an Urgent flag the
 *      leave-Active side effects have just cleared.
 */
async function runCommand<P extends ReasonPolicy, Extra extends object>(
  prisma: PrismaClient,
  target: CommandTarget,
  command: CommandDeclaration<P, Extra>
): Promise<LifecycleResult & Extra> {
  const { campaignId, actor, now = new Date() } = target;
  const { authority } = command;
  if (
    authority.kind === "operator" &&
    !actor.assignments.includes(OPERATOR_ASSIGNMENT[authority.capacity])
  ) {
    throw new NotAuthorizedError(authority.message);
  }
  let reason: string | null =
    command.reasonPolicy === "required" ? requireReason(command.rawReason) : null;
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    const campaign = await lockAndRead(tx, campaignId, now);
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    const capacity = authorize(authority, actor, campaign);
    if (command.reasonPolicy === "requiredUnlessFundraiser") {
      reason =
        capacity === StatusChangeCapacity.FUNDRAISER
          ? optionalReason(command.rawReason)
          : requireReason(command.rawReason);
    }
    const current = effectiveStatus(campaign, now);
    if (command.allowedFrom && !command.allowedFrom.includes(current)) {
      throw new InvalidTransitionError(current);
    }
    const extra = await command.step({
      tx,
      campaign,
      current,
      now,
      actor,
      capacity,
      reason: reason as ReasonFor<P>,
      transition: (to, action) =>
        transition(tx, campaign, { to, action, actorId: actor.userId, capacity, reason }, now),
      notify: (notification) => notifyFundraiser(tx, campaign, actor.userId, notification),
    });
    const state = await tx.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: CAMPAIGN_STATE,
    });
    return { campaign: state, ...extra };
  });
}

// ==================== Commands ====================

const SUBMISSION_DECISIONS = {
  approve: {
    to: CampaignStatus.ACTIVE,
    action: CampaignStatusChangeAction.SUBMISSION_APPROVED,
    title: "Campaign Disetujui",
    message: (title: string) =>
      `Campaign "${title}" telah disetujui dan kini aktif menerima donasi.`,
  },
  reject: {
    to: CampaignStatus.REJECTED,
    action: CampaignStatusChangeAction.SUBMISSION_REJECTED,
    title: "Campaign Ditolak",
    message: (title: string) =>
      `Campaign "${title}" ditolak setelah ditinjau oleh Verifier.`,
  },
} as const;

export type SubmissionDecision = keyof typeof SUBMISSION_DECISIONS;

export function isSubmissionDecision(value: unknown): value is SubmissionDecision {
  return typeof value === "string" && Object.hasOwn(SUBMISSION_DECISIONS, value);
}

/**
 * A Verifier approves (ACTIVE) or rejects (REJECTED) a Submitted Campaign.
 * Any other effective status is refused, so moderation can never reopen a
 * Suspended, Completed or Cancelled Campaign. Recorded in the VERIFIER
 * capacity, without a reason: rejection reasons belong to Verification
 * Request (ticket 12). A Verifier never decides on a Campaign they own.
 */
export async function decideSubmission(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    decision: SubmissionDecision;
    now?: Date;
  }
): Promise<LifecycleResult> {
  const decision = SUBMISSION_DECISIONS[params.decision];
  return runCommand(prisma, params, {
    authority: {
      kind: "operator",
      capacity: StatusChangeCapacity.VERIFIER,
      message: "Hanya Verifier yang dapat menyetujui atau menolak Campaign.",
    },
    reasonPolicy: "none",
    allowedFrom: [CampaignStatus.SUBMITTED],
    step: async ({ campaign, transition, notify }) => {
      await transition(decision.to, decision.action);
      await notify({ title: decision.title, message: decision.message(campaign.title) });
      return {};
    },
  });
}

// ==================== Completion (ticket 03) ====================

/**
 * Marks an Active Campaign Completed (ADR 0004, FFI-03). Completed is final:
 * its only exit is Suspension (ADR 0015). Reaching the target never gets
 * here on its own; a person always decides.
 *
 * The owner acts as FUNDRAISER, even when they also hold ADMIN, and needs no
 * reason: their Campaign Update is the explanation. Anyone else needs the
 * ADMIN assignment and a reason, and the Fundraiser is told why. Either way
 * the Campaign must have at least one Campaign Update, so no Campaign closes
 * without its Donors having heard from the Fundraiser.
 */
export async function completeCampaign(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    reason?: unknown;
    now?: Date;
  }
): Promise<LifecycleResult> {
  return runCommand(prisma, params, {
    authority: {
      kind: "fundraiserOrAdmin",
      message:
        "Hanya Fundraiser pemilik Campaign atau Admin yang dapat menandai Campaign Completed.",
    },
    reasonPolicy: "requiredUnlessFundraiser",
    rawReason: params.reason,
    allowedFrom: [CampaignStatus.ACTIVE],
    step: async ({ tx, campaign, capacity, reason, transition, notify }) => {
      const updates = await tx.campaignUpdate.count({ where: { campaignId: campaign.id } });
      if (updates === 0) throw new MissingCampaignUpdateError();
      await transition(CampaignStatus.COMPLETED, CampaignStatusChangeAction.COMPLETED);
      if (capacity === StatusChangeCapacity.ADMIN) {
        await notify({
          title: "Campaign Ditandai Completed",
          message: `Campaign "${campaign.title}" ditandai Completed oleh Admin dan tidak lagi menerima donasi. Alasan: ${reason}`,
        });
      }
      return {};
    },
  });
}

// ==================== Cancellation (ticket 07) ====================

/** No such request on this Campaign (a request is always addressed through its Campaign). */
export class CancellationRequestNotFoundError extends CampaignLifecycleError {
  readonly code = "CANCELLATION_REQUEST_NOT_FOUND";
  constructor(readonly requestId: string) {
    super("Pengajuan Cancellation tidak ditemukan.");
    this.name = "CancellationRequestNotFoundError";
  }
}

/** The request was already decided, or lapsed when the Campaign left Active. */
export class CancellationNotPendingError extends CampaignLifecycleError {
  readonly code = "CANCELLATION_NOT_PENDING";
  constructor(readonly status: CancellationRequestStatus) {
    super(
      status === CancellationRequestStatus.SUPERSEDED
        ? "Pengajuan Cancellation ini sudah gugur karena Campaign tidak lagi Active."
        : "Pengajuan Cancellation ini sudah diputuskan."
    );
    this.name = "CancellationNotPendingError";
  }
}

export type CancellationRequestState = {
  id: string;
  campaignId: string;
  requestedById: string;
  reason: string;
  status: CancellationRequestStatus;
  decidedById: string | null;
  decisionReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

export type CancellationResult = LifecycleResult & {
  cancellationRequest: CancellationRequestState;
};

/**
 * The Fundraiser of an Active Campaign asks for its Cancellation, with a reason. Nothing
 * about the Campaign changes: it stays Active and keeps taking Donations
 * until an Admin decides, so a Fundraiser can never freeze their own Campaign.
 * Refused while another request on the Campaign is still PENDING.
 */
export async function requestCancellation(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    reason: unknown;
    now?: Date;
  }
): Promise<CancellationResult> {
  return runCommand(prisma, params, {
    authority: {
      kind: "fundraiser",
      message: "Hanya Fundraiser pemilik Campaign yang dapat mengajukan Cancellation.",
    },
    reasonPolicy: "required",
    rawReason: params.reason,
    allowedFrom: [CampaignStatus.ACTIVE],
    step: async ({ tx, campaign, actor, reason, now }) => {
      const pending = await tx.cancellationRequest.findFirst({
        where: { campaignId: campaign.id, status: CancellationRequestStatus.PENDING },
      });
      if (pending) throw new CancellationAlreadyPendingError();
      const cancellationRequest = await tx.cancellationRequest.create({
        data: { campaignId: campaign.id, requestedById: actor.userId, reason, createdAt: now },
      });
      return { cancellationRequest };
    },
  });
}

const CANCELLATION_DECISIONS = {
  approve: {
    status: CancellationRequestStatus.APPROVED,
    title: "Cancellation Disetujui",
    message: (title: string, reason: string) =>
      `Pengajuan Cancellation untuk Campaign "${title}" disetujui Admin. Campaign kini Cancelled dan tidak lagi menerima donasi. Alasan: ${reason}`,
  },
  reject: {
    status: CancellationRequestStatus.REJECTED,
    title: "Cancellation Ditolak",
    message: (title: string, reason: string) =>
      `Pengajuan Cancellation untuk Campaign "${title}" ditolak Admin. Campaign tetap Active dan tetap menerima donasi. Alasan: ${reason}`,
  },
} as const;

export type CancellationDecision = keyof typeof CANCELLATION_DECISIONS;

/**
 * An Admin who is not the Campaign's Fundraiser approves or rejects its PENDING
 * Cancellation request, with a reason. Approval makes the Campaign CANCELLED,
 * but only from effective ACTIVE and only while no Payout on it has
 * COMPLETED, checked under the Campaign row lock so a Payout cannot complete
 * between the check and the write. Rejection changes only the request. A
 * Campaign found past its deadline is first recorded Expired, which lapses
 * the request, so the decision is then refused as no longer pending.
 */
export async function decideCancellation(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    requestId: string;
    actor: LifecycleActor;
    decision: CancellationDecision;
    reason: unknown;
    now?: Date;
  }
): Promise<CancellationResult> {
  const { requestId } = params;
  const decision = CANCELLATION_DECISIONS[params.decision];
  return runCommand(prisma, params, {
    authority: {
      kind: "operator",
      capacity: StatusChangeCapacity.ADMIN,
      message: "Hanya Admin yang dapat memutuskan pengajuan Cancellation.",
    },
    reasonPolicy: "required",
    rawReason: params.reason,
    // The request is judged before the status: a missing or decided request
    // answers as such whatever the Campaign's status, and only approval
    // needs an Active Campaign.
    step: async ({ tx, campaign, current, actor, reason, now, transition, notify }) => {
      const request = await tx.cancellationRequest.findUnique({ where: { id: requestId } });
      if (!request || request.campaignId !== campaign.id) {
        throw new CancellationRequestNotFoundError(requestId);
      }
      if (request.status !== CancellationRequestStatus.PENDING) {
        throw new CancellationNotPendingError(request.status);
      }
      if (decision.status === CancellationRequestStatus.APPROVED) {
        if (current !== CampaignStatus.ACTIVE) throw new InvalidTransitionError(current);
        const completedPayouts = await tx.payout.count({
          where: { campaignId: campaign.id, status: PayoutStatus.COMPLETED },
        });
        if (completedPayouts > 0) throw new PayoutAlreadyCompletedError();
      }
      // Decided before the status write, so the leave-Active hook's sweep of
      // PENDING requests does not mark this very request SUPERSEDED.
      const cancellationRequest = await tx.cancellationRequest.update({
        where: { id: requestId },
        data: {
          status: decision.status,
          decidedById: actor.userId,
          decisionReason: reason,
          decidedAt: now,
        },
      });
      if (decision.status === CancellationRequestStatus.APPROVED) {
        await transition(CampaignStatus.CANCELLED, CampaignStatusChangeAction.CANCELLED);
      }
      await notify({ title: decision.title, message: decision.message(campaign.title, reason) });
      return { cancellationRequest };
    },
  });
}

// ==================== Suspension (ticket 05) ====================

/**
 * A Suspension with no SUSPENDED log row: imposed before the log existed,
 * so the status to return to is unknown. Still an invalid transition (409),
 * but it says why, since lifting is otherwise exactly what a Suspended
 * Campaign expects.
 */
export class UnrecordedSuspensionError extends InvalidTransitionError {
  constructor() {
    super(CampaignStatus.SUSPENDED);
    this.message =
      "Suspension ini dijatuhkan sebelum riwayat status dicatat, sehingga status Campaign sebelum Suspension tidak diketahui. Hubungi tim teknis untuk mencabutnya.";
    this.name = "UnrecordedSuspensionError";
  }
}

/** The statuses an Admin may suspend from (ADR 0015). */
const SUSPENDABLE: readonly CampaignStatus[] = [
  CampaignStatus.ACTIVE,
  CampaignStatus.EXPIRED,
  CampaignStatus.COMPLETED,
];

/**
 * An Admin suspends a Campaign that is Active, Expired or Completed, with a
 * reason (ADR 0015, FFI-07b), never one they own. Suspending an Active
 * Campaign clears Urgent through the leave-Active side effects. Every open
 * Flag on the Campaign is resolved SUSPENDED, with this Admin as resolver
 * and the Suspension's reason, in the same transaction. The Fundraiser is
 * told why.
 */
export async function suspendCampaign(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    reason: unknown;
    now?: Date;
  }
): Promise<LifecycleResult> {
  return runCommand(prisma, params, {
    authority: {
      kind: "operator",
      capacity: StatusChangeCapacity.ADMIN,
      message: "Hanya Admin yang dapat menjatuhkan Suspension.",
    },
    reasonPolicy: "required",
    rawReason: params.reason,
    allowedFrom: SUSPENDABLE,
    step: async ({ tx, campaign, actor, reason, now, transition, notify }) => {
      await transition(CampaignStatus.SUSPENDED, CampaignStatusChangeAction.SUSPENDED);
      // The Suspension is the decision every open Flag was waiting for. A
      // Flag takes the same row lock, so one committed before this command
      // got the lock is seen and resolved here, and none can land after.
      await tx.campaignFlag.updateMany({
        where: { campaignId: campaign.id, resolution: null },
        data: {
          resolution: FlagResolution.SUSPENDED,
          resolvedById: actor.userId,
          resolutionReason: reason,
          resolvedAt: now,
        },
      });
      await notify({
        title: "Campaign Dibekukan",
        message: `Campaign "${campaign.title}" dibekukan (Suspended) oleh Admin. Alasan: ${reason}`,
      });
      return {};
    },
  });
}

/**
 * An Admin lifts a Suspension, with a reason: never on a Campaign they own,
 * and never the Admin who imposed the latest Suspension, so every
 * Suspension passes two pairs of hands before it ends (FFI-07b). The
 * Campaign returns to the status it had before, except that one which was
 * Active and whose deadline has since passed lands on Expired. Urgent is
 * never restored. The Fundraiser is told why.
 */
export async function liftSuspension(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    reason: unknown;
    now?: Date;
  }
): Promise<LifecycleResult> {
  return runCommand(prisma, params, {
    authority: {
      kind: "operator",
      capacity: StatusChangeCapacity.ADMIN,
      message: "Hanya Admin yang dapat mencabut Suspension.",
    },
    reasonPolicy: "required",
    rawReason: params.reason,
    allowedFrom: [CampaignStatus.SUSPENDED],
    step: async ({ tx, campaign, actor, reason, now, transition, notify }) => {
      // The status before the Suspension lives in the log, not in a column
      // (ADR 0015). A Suspension imposed before the log existed has no row;
      // its prior status is unknown (the old Verifier suspend also reached
      // Submitted Campaigns), so it is refused rather than guessed.
      const suspension = await tx.campaignStatusChange.findFirst({
        where: { campaignId: campaign.id, action: CampaignStatusChangeAction.SUSPENDED },
        orderBy: { createdAt: "desc" },
      });
      if (!suspension?.fromStatus) throw new UnrecordedSuspensionError();
      if (suspension.actorId === actor.userId) throw new SameAdminLiftError();
      // A Campaign that was Active comes back only if its deadline still lies
      // ahead; otherwise it can never take a Donation again and is Expired.
      const to = effectiveStatus(
        { lifecycleStatus: suspension.fromStatus, deadline: campaign.deadline },
        now
      );
      await transition(to, CampaignStatusChangeAction.SUSPENSION_LIFTED);
      await notify({
        title: "Suspension Dicabut",
        message: `Suspension atas Campaign "${campaign.title}" telah dicabut oleh Admin. Campaign kini ${STATUS_LABEL[to]}. Alasan: ${reason}`,
      });
      return {};
    },
  });
}

// ==================== Urgent (ticket 04) ====================

/**
 * An Admin sets or clears Urgent on a Campaign they do not own, with a
 * reason, so the homepage rail and the `?urgent` filter show an operator's
 * judgement. Urgent is not a status: nothing moves, but each change is
 * recorded (URGENT_SET / URGENT_CLEARED, capacity ADMIN) in the same log.
 *
 * Setting needs an effectively Active Campaign; clearing is allowed
 * whenever the flag is set, whatever the status. Asking for the state the
 * Campaign is already in changes and records nothing (this backs a PUT),
 * so a double click never produces two log rows.
 */
export async function setUrgent(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    urgent: boolean;
    reason: unknown;
    now?: Date;
  }
): Promise<LifecycleResult> {
  const { urgent } = params;
  return runCommand(prisma, params, {
    authority: {
      kind: "operator",
      capacity: StatusChangeCapacity.ADMIN,
      message: "Hanya Admin yang dapat memasang atau melepas Urgent.",
    },
    reasonPolicy: "required",
    rawReason: params.reason,
    allowedFrom: urgent ? [CampaignStatus.ACTIVE] : undefined,
    step: async ({ tx, campaign, actor, capacity, reason, now }) => {
      if (campaign.isUrgent === urgent) return {};
      // The runner holds the Campaign row lock from before its read, so
      // the status and flag judged above are still current: no predicate.
      await tx.campaign.update({ where: { id: campaign.id }, data: { isUrgent: urgent } });
      await tx.campaignStatusChange.create({
        data: {
          campaignId: campaign.id,
          action: urgent
            ? CampaignStatusChangeAction.URGENT_SET
            : CampaignStatusChangeAction.URGENT_CLEARED,
          fromStatus: null,
          toStatus: null,
          actorId: actor.userId,
          capacity,
          reason,
          createdAt: now,
        },
      });
      return {};
    },
  });
}

// ==================== Flags (ticket 06) ====================

/** No such Flag on this Campaign (a Flag is always addressed through its Campaign). */
export class FlagNotFoundError extends CampaignLifecycleError {
  readonly code = "FLAG_NOT_FOUND";
  constructor(readonly flagId: string) {
    super("Flag tidak ditemukan.");
    this.name = "FlagNotFoundError";
  }
}

/** The Flag was already dismissed, or resolved by a Suspension. */
export class FlagAlreadyResolvedError extends CampaignLifecycleError {
  readonly code = "FLAG_ALREADY_RESOLVED";
  constructor(readonly resolution: FlagResolution) {
    super(
      resolution === FlagResolution.SUSPENDED
        ? "Flag ini sudah selesai karena Campaign telah dibekukan (Suspended)."
        : "Flag ini sudah ditolak oleh Admin."
    );
    this.name = "FlagAlreadyResolvedError";
  }
}

export type CampaignFlagState = {
  id: string;
  campaignId: string;
  verifierId: string;
  reason: string;
  createdAt: Date;
  resolution: FlagResolution | null;
  resolvedById: string | null;
  resolutionReason: string | null;
  resolvedAt: Date | null;
};

export type FlagResult = LifecycleResult & { flag: CampaignFlagState };

/**
 * A Flag asks an Admin to consider Suspension, so it can be raised exactly
 * where Suspension is possible (ADR 0015).
 */
const FLAGGABLE = SUSPENDABLE;

/**
 * A Verifier raises a Flag on a Campaign, with a reason, so an Admin can
 * decide on Suspension (FFI-07b, ADR 0005). Nothing about the Campaign
 * changes. Allowed on an effectively Active, Expired or Completed Campaign
 * (the statuses an Admin can suspend from, ADR 0015), so fraud found after a
 * Campaign closed still reaches an Admin. Several open Flags are kept
 * separately, each with its author. The Fundraiser is not told. A Verifier
 * never flags a Campaign they own.
 */
export async function flagCampaign(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    reason: unknown;
    now?: Date;
  }
): Promise<FlagResult> {
  return runCommand(prisma, params, {
    authority: {
      kind: "operator",
      capacity: StatusChangeCapacity.VERIFIER,
      message: "Hanya Verifier yang dapat memasang Flag pada Campaign.",
    },
    reasonPolicy: "required",
    rawReason: params.reason,
    // Under the row lock a Suspension serialises with this Flag: either it
    // committed first and this Flag is refused, or this Flag commits first
    // and the Suspension resolves it.
    allowedFrom: FLAGGABLE,
    step: async ({ tx, campaign, actor, reason, now }) => {
      const flag = await tx.campaignFlag.create({
        data: { campaignId: campaign.id, verifierId: actor.userId, reason, createdAt: now },
      });
      return { flag };
    },
  });
}

/**
 * An Admin who is not the Campaign's Fundraiser dismisses an open Flag, with
 * a reason, closing on the record a report that does not justify Suspension.
 * Nothing about the Campaign changes, whatever its status. The Fundraiser
 * is not told, just as they were not told of the Flag.
 */
export async function dismissFlag(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    flagId: string;
    actor: LifecycleActor;
    reason: unknown;
    now?: Date;
  }
): Promise<FlagResult> {
  const { flagId } = params;
  return runCommand(prisma, params, {
    authority: {
      kind: "operator",
      capacity: StatusChangeCapacity.ADMIN,
      message: "Hanya Admin yang dapat menolak Flag.",
    },
    reasonPolicy: "required",
    rawReason: params.reason,
    step: async ({ tx, campaign, actor, reason, now }) => {
      const existing = await tx.campaignFlag.findUnique({ where: { id: flagId } });
      if (!existing || existing.campaignId !== campaign.id) throw new FlagNotFoundError(flagId);
      if (existing.resolution !== null) {
        throw new FlagAlreadyResolvedError(existing.resolution);
      }
      const flag = await tx.campaignFlag.update({
        where: { id: flagId },
        data: {
          resolution: FlagResolution.DISMISSED,
          resolvedById: actor.userId,
          resolutionReason: reason,
          resolvedAt: now,
        },
      });
      return { flag };
    },
  });
}
