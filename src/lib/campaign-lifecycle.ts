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
 * maintain, never the legacy string.
 */
export function campaignAcceptsDonations(campaign: {
  lifecycleStatus: CampaignStatus;
}): boolean {
  return campaign.lifecycleStatus === CampaignStatus.ACTIVE;
}

// ==================== Typed errors ====================

/**
 * Every refusal the lifecycle module can produce. `message` is the
 * Indonesian sentence shown to the person who acted; `code` is stable for
 * clients. `lifecycleErrorToHttp` is the one place a refusal becomes an HTTP
 * status, so every lifecycle route answers the same refusal the same way.
 */
export abstract class CampaignLifecycleError extends Error {
  abstract readonly code: LifecycleErrorCode;
}

export type LifecycleErrorCode =
  | "VALIDATION"
  | "NOT_AUTHORIZED"
  | "OWN_CAMPAIGN_CONFLICT"
  | "SAME_ADMIN_LIFT"
  | "CAMPAIGN_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONCURRENT_TRANSITION"
  | "PAYOUT_ALREADY_COMPLETED"
  | "CANCELLATION_ALREADY_PENDING"
  | "MISSING_CAMPAIGN_UPDATE"
  | "CANCELLATION_REQUEST_NOT_FOUND"
  | "CANCELLATION_NOT_PENDING"
  | "FLAG_NOT_FOUND"
  | "FLAG_ALREADY_RESOLVED";

/** Glossary names (CONTEXT.md), used as-is inside Indonesian sentences. */
const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  REJECTED: "Rejected",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  EXPIRED: "Expired",
};

/** A required input is missing or malformed, such as a blank reason. */
export class LifecycleValidationError extends CampaignLifecycleError {
  readonly code = "VALIDATION";
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "LifecycleValidationError";
  }
}

/** Missing the assignment the action needs, or not the Campaign's owner. */
export class NotAuthorizedError extends CampaignLifecycleError {
  readonly code = "NOT_AUTHORIZED";
  constructor(message = "Anda tidak berwenang melakukan tindakan ini pada Campaign ini.") {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

/** The operator role a person was trying to act in on a Campaign they own. */
export type OperatorCapacity = "Admin" | "Verifier";

/**
 * An Admin or Verifier tried to act in that role on a Campaign they own
 * (CONTEXT.md, Admin and Verifier; ADR 0005).
 */
export class OwnCampaignConflictError extends CampaignLifecycleError {
  readonly code = "OWN_CAMPAIGN_CONFLICT";
  constructor(readonly capacity: OperatorCapacity = "Admin") {
    super(
      `Anda tidak dapat bertindak sebagai ${capacity} atas Campaign milik Anda sendiri. Tindakan ini harus dilakukan ${capacity} lain.`
    );
    this.name = "OwnCampaignConflictError";
  }
}

/** The Admin who imposed the latest Suspension tried to lift it. */
export class SameAdminLiftError extends CampaignLifecycleError {
  readonly code = "SAME_ADMIN_LIFT";
  constructor() {
    super(
      "Suspension ini harus dicabut oleh Admin lain, bukan Admin yang menjatuhkannya."
    );
    this.name = "SameAdminLiftError";
  }
}

export class CampaignNotFoundError extends CampaignLifecycleError {
  readonly code = "CAMPAIGN_NOT_FOUND";
  constructor(readonly campaignId: string) {
    super("Campaign tidak ditemukan.");
    this.name = "CampaignNotFoundError";
  }
}

/** The action is not legal from the Campaign's effective status. */
export class InvalidTransitionError extends CampaignLifecycleError {
  readonly code = "INVALID_TRANSITION";
  constructor(readonly currentStatus: CampaignStatus) {
    super(
      `Tindakan ini tidak dapat dilakukan pada Campaign berstatus ${STATUS_LABEL[currentStatus]}.`
    );
    this.name = "InvalidTransitionError";
  }
}

/** The predicated status write matched no row: someone else moved it first. */
export class ConcurrentTransitionError extends CampaignLifecycleError {
  readonly code = "CONCURRENT_TRANSITION";
  constructor() {
    super(
      "Status Campaign baru saja diubah oleh orang lain. Muat ulang halaman lalu periksa kembali."
    );
    this.name = "ConcurrentTransitionError";
  }
}

export class MissingCampaignUpdateError extends CampaignLifecycleError {
  readonly code = "MISSING_CAMPAIGN_UPDATE";
  constructor() {
    super(
      "Campaign harus memiliki minimal satu Campaign Update sebelum dapat ditandai Completed."
    );
    this.name = "MissingCampaignUpdateError";
  }
}

export class PayoutAlreadyCompletedError extends CampaignLifecycleError {
  readonly code = "PAYOUT_ALREADY_COMPLETED";
  constructor() {
    super(
      "Cancellation tidak dapat disetujui karena sudah ada Payout yang Completed pada Campaign ini."
    );
    this.name = "PayoutAlreadyCompletedError";
  }
}

export class CancellationAlreadyPendingError extends CampaignLifecycleError {
  readonly code = "CANCELLATION_ALREADY_PENDING";
  constructor() {
    super("Masih ada pengajuan Cancellation yang menunggu keputusan Admin.");
    this.name = "CancellationAlreadyPendingError";
  }
}

const HTTP_STATUS: Record<LifecycleErrorCode, number> = {
  VALIDATION: 400,
  NOT_AUTHORIZED: 403,
  OWN_CAMPAIGN_CONFLICT: 403,
  SAME_ADMIN_LIFT: 403,
  CAMPAIGN_NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  CONCURRENT_TRANSITION: 409,
  PAYOUT_ALREADY_COMPLETED: 409,
  CANCELLATION_ALREADY_PENDING: 409,
  MISSING_CAMPAIGN_UPDATE: 422,
  CANCELLATION_REQUEST_NOT_FOUND: 404,
  CANCELLATION_NOT_PENDING: 409,
  FLAG_NOT_FOUND: 404,
  FLAG_ALREADY_RESOLVED: 409,
};

/**
 * The single mapping from a lifecycle refusal to an HTTP answer, shared by
 * every lifecycle route. Returns null for anything that is not a lifecycle
 * refusal, so the route treats it as the unexpected failure it is.
 */
export function lifecycleErrorToHttp(
  error: unknown
): { status: number; body: { error: string; code: LifecycleErrorCode } } | null {
  if (!(error instanceof CampaignLifecycleError)) return null;
  return {
    status: HTTP_STATUS[error.code],
    body: { error: error.message, code: error.code },
  };
}

// ==================== Effective status ====================

/**
 * The status a command is judged against. An ACTIVE Campaign whose deadline
 * has passed is EXPIRED whether or not anyone has recorded that yet; every
 * other status, and a Campaign without a deadline, is taken as stored.
 */
export function effectiveStatus(
  campaign: { lifecycleStatus: CampaignStatus; deadline: Date | null },
  now: Date
): CampaignStatus {
  if (
    campaign.lifecycleStatus === CampaignStatus.ACTIVE &&
    campaign.deadline !== null &&
    campaign.deadline < now
  ) {
    return CampaignStatus.EXPIRED;
  }
  return campaign.lifecycleStatus;
}

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
 * command judged; records the change; runs the leave-Active side effects.
 * Returns the Campaign as re-read after all of that, so a caller never
 * reports an Urgent flag the side effects have just cleared.
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
  }
): Promise<CampaignState> {
  const from = campaign.lifecycleStatus;
  // Predicated on the status this command read and judged: if another
  // request moved the Campaign in between, nothing matches and this
  // command loses instead of overwriting a decision it never saw.
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
    },
  });
  if (from === CampaignStatus.ACTIVE && change.to !== CampaignStatus.ACTIVE) {
    await leaveActive(tx, campaign.id, change.to);
  }
  return tx.campaign.findUniqueOrThrow({
    where: { id: campaign.id },
    select: CAMPAIGN_STATE,
  });
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
  to: CampaignStatus
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
      },
    });
  }
  // Nobody decided it, so decidedById stays null; decidedAt says when it lapsed.
  await tx.cancellationRequest.updateMany({
    where: { campaignId, status: CancellationRequestStatus.PENDING },
    data: { status: CancellationRequestStatus.SUPERSEDED, decidedAt: new Date() },
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
 * Every command calls this BEFORE opening its own transaction, so the
 * expiry is committed on its own and survives the command being refused:
 * the stored status catches up with reality the moment anyone acts. The
 * scheduled expiry job (ticket 20) calls this same function.
 *
 * If another request moves the Campaign first, this writes nothing and
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
      await transition(tx, campaign, {
        to: CampaignStatus.EXPIRED,
        action: CampaignStatusChangeAction.EXPIRED,
        actorId: null,
        capacity: StatusChangeCapacity.SYSTEM,
      });
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
  const { campaignId, actor, now = new Date() } = params;
  const decision = SUBMISSION_DECISIONS[params.decision];
  requireVerifierAssignment(
    actor,
    "Hanya Verifier yang dapat menyetujui atau menolak Campaign."
  );
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    requireNotOwner(actor, campaign, "Verifier");
    const current = effectiveStatus(campaign, now);
    if (current !== CampaignStatus.SUBMITTED) {
      throw new InvalidTransitionError(current);
    }
    const updated = await transition(tx, campaign, {
      to: decision.to,
      action: decision.action,
      actorId: actor.userId,
      capacity: StatusChangeCapacity.VERIFIER,
    });
    await notifyFundraiser(tx, campaign, actor.userId, {
      title: decision.title,
      message: decision.message(campaign.title),
    });
    return { campaign: updated };
  });
}

// ==================== Completion (ticket 03) ====================

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
  const { campaignId, actor, now = new Date() } = params;
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);

    const asOwner = campaign.creatorId === actor.userId;
    if (!asOwner && !actor.assignments.includes(Assignment.ADMIN)) {
      throw new NotAuthorizedError(
        "Hanya Fundraiser pemilik Campaign atau Admin yang dapat menandai Campaign Completed."
      );
    }
    const reason = asOwner ? optionalReason(params.reason) : requireReason(params.reason);

    const current = effectiveStatus(campaign, now);
    if (current !== CampaignStatus.ACTIVE) {
      throw new InvalidTransitionError(current);
    }
    const updates = await tx.campaignUpdate.count({ where: { campaignId } });
    if (updates === 0) throw new MissingCampaignUpdateError();

    const updated = await transition(tx, campaign, {
      to: CampaignStatus.COMPLETED,
      action: CampaignStatusChangeAction.COMPLETED,
      actorId: actor.userId,
      capacity: asOwner ? StatusChangeCapacity.FUNDRAISER : StatusChangeCapacity.ADMIN,
      reason,
    });
    if (!asOwner) {
      await notifyFundraiser(tx, campaign, actor.userId, {
        title: "Campaign Ditandai Completed",
        message: `Campaign "${campaign.title}" ditandai Completed oleh Admin dan tidak lagi menerima donasi. Alasan: ${reason}`,
      });
    }
    return { campaign: updated };
  });
}

// ==================== Cancellation (ticket 07) ====================

/** The ADMIN assignment, checked before anything is read or written. */
function requireAdminAssignment(actor: LifecycleActor, message: string): void {
  if (!actor.assignments.includes(Assignment.ADMIN)) {
    throw new NotAuthorizedError(message);
  }
}

/** The VERIFIER assignment, checked before anything is read or written. */
function requireVerifierAssignment(actor: LifecycleActor, message: string): void {
  if (!actor.assignments.includes(Assignment.VERIFIER)) {
    throw new NotAuthorizedError(message);
  }
}

/**
 * No Admin ever acts as Admin, and no Verifier as Verifier, on a Campaign
 * they own (CONTEXT.md, Admin and Verifier). On it they are only its
 * Fundraiser.
 */
function requireNotOwner(
  actor: LifecycleActor,
  campaign: { creatorId: string },
  capacity: OperatorCapacity = "Admin"
): void {
  if (campaign.creatorId === actor.userId) {
    throw new OwnCampaignConflictError(capacity);
  }
}

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
 * Serialises every Cancellation and Flag write on one Campaign: the "at most
 * one PENDING request", "no Payout COMPLETED", "Campaign still flaggable" and
 * "Flag still open" checks are reads that only stay true while this
 * transaction holds the Campaign row, the same pattern the balance-touching
 * Payout operations use (src/lib/money/payouts.ts). A Suspension's status
 * write takes the same row, so it serialises with these too.
 *
 * The Payout guarantee is only as strong as its writer: nothing marks a
 * Payout COMPLETED yet, and the endpoint that will must take this same
 * Campaign row lock, or a Payout could complete between check and write.
 */
async function lockCampaignRow(tx: Tx, campaignId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
}

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
  const { campaignId, actor, now = new Date() } = params;
  const reason = requireReason(params.reason);
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    // Lock first, then read: a status judged from a copy read before the
    // lock could let a request land on a Campaign that was just suspended,
    // after the leave-Active sweep that would have lapsed it has already run.
    await lockCampaignRow(tx, campaignId);
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    if (campaign.creatorId !== actor.userId) {
      throw new NotAuthorizedError(
        "Hanya Fundraiser pemilik Campaign yang dapat mengajukan Cancellation."
      );
    }
    const current = effectiveStatus(campaign, now);
    if (current !== CampaignStatus.ACTIVE) {
      throw new InvalidTransitionError(current);
    }
    const pending = await tx.cancellationRequest.findFirst({
      where: { campaignId, status: CancellationRequestStatus.PENDING },
    });
    if (pending) throw new CancellationAlreadyPendingError();
    const cancellationRequest = await tx.cancellationRequest.create({
      data: { campaignId, requestedById: actor.userId, reason },
    });
    const updated = await tx.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: CAMPAIGN_STATE,
    });
    return { campaign: updated, cancellationRequest };
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
  const { campaignId, requestId, actor, now = new Date() } = params;
  const decision = CANCELLATION_DECISIONS[params.decision];
  requireAdminAssignment(actor, "Hanya Admin yang dapat memutuskan pengajuan Cancellation.");
  const reason = requireReason(params.reason);
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    // Lock first, then read, so every check below sees the Campaign and the
    // request as they stand while this transaction holds the row.
    await lockCampaignRow(tx, campaignId);
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    requireNotOwner(actor, campaign);
    const request = await tx.cancellationRequest.findUnique({ where: { id: requestId } });
    if (!request || request.campaignId !== campaignId) {
      throw new CancellationRequestNotFoundError(requestId);
    }
    if (request.status !== CancellationRequestStatus.PENDING) {
      throw new CancellationNotPendingError(request.status);
    }
    if (decision.status === CancellationRequestStatus.APPROVED) {
      const current = effectiveStatus(campaign, now);
      if (current !== CampaignStatus.ACTIVE) {
        throw new InvalidTransitionError(current);
      }
      const completedPayouts = await tx.payout.count({
        where: { campaignId, status: PayoutStatus.COMPLETED },
      });
      if (completedPayouts > 0) throw new PayoutAlreadyCompletedError();
    }
    // Claimed before the status write, so the leave-Active hook's sweep of
    // PENDING requests does not mark this very request SUPERSEDED.
    const claimed = await tx.cancellationRequest.updateMany({
      where: { id: requestId, status: CancellationRequestStatus.PENDING },
      data: {
        status: decision.status,
        decidedById: actor.userId,
        decisionReason: reason,
        decidedAt: now,
      },
    });
    if (claimed.count === 0) throw new ConcurrentTransitionError();
    const updated =
      decision.status === CancellationRequestStatus.APPROVED
        ? await transition(tx, campaign, {
            to: CampaignStatus.CANCELLED,
            action: CampaignStatusChangeAction.CANCELLED,
            actorId: actor.userId,
            capacity: StatusChangeCapacity.ADMIN,
            reason,
          })
        : await tx.campaign.findUniqueOrThrow({
            where: { id: campaignId },
            select: CAMPAIGN_STATE,
          });
    await notifyFundraiser(tx, campaign, actor.userId, {
      title: decision.title,
      message: decision.message(campaign.title, reason),
    });
    const cancellationRequest = await tx.cancellationRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    return { campaign: updated, cancellationRequest };
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
  const { campaignId, actor, now = new Date() } = params;
  requireAdminAssignment(actor, "Hanya Admin yang dapat menjatuhkan Suspension.");
  const reason = requireReason(params.reason);
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    requireNotOwner(actor, campaign);
    const current = effectiveStatus(campaign, now);
    if (!SUSPENDABLE.includes(current)) {
      throw new InvalidTransitionError(current);
    }
    const updated = await transition(tx, campaign, {
      to: CampaignStatus.SUSPENDED,
      action: CampaignStatusChangeAction.SUSPENDED,
      actorId: actor.userId,
      capacity: StatusChangeCapacity.ADMIN,
      reason,
    });
    // The Suspension is the decision every open Flag was waiting for.
    // After transition(), which holds the row lock a Flag also takes, so a
    // Flag committed before this point is seen and resolved here.
    await tx.campaignFlag.updateMany({
      where: { campaignId, resolution: null },
      data: {
        resolution: FlagResolution.SUSPENDED,
        resolvedById: actor.userId,
        resolutionReason: reason,
        resolvedAt: now,
      },
    });
    await notifyFundraiser(tx, campaign, actor.userId, {
      title: "Campaign Dibekukan",
      message: `Campaign "${campaign.title}" dibekukan (Suspended) oleh Admin. Alasan: ${reason}`,
    });
    return { campaign: updated };
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
  const { campaignId, actor, now = new Date() } = params;
  requireAdminAssignment(actor, "Hanya Admin yang dapat mencabut Suspension.");
  const reason = requireReason(params.reason);
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    requireNotOwner(actor, campaign);
    const current = effectiveStatus(campaign, now);
    if (current !== CampaignStatus.SUSPENDED) {
      throw new InvalidTransitionError(current);
    }
    // The status before the Suspension lives in the log, not in a column
    // (ADR 0015). A Suspension imposed before the log existed has no row;
    // its prior status is unknown (the old Verifier suspend also reached
    // Submitted Campaigns), so it is refused rather than guessed.
    const suspension = await tx.campaignStatusChange.findFirst({
      where: { campaignId, action: CampaignStatusChangeAction.SUSPENDED },
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
    const updated = await transition(tx, campaign, {
      to,
      action: CampaignStatusChangeAction.SUSPENSION_LIFTED,
      actorId: actor.userId,
      capacity: StatusChangeCapacity.ADMIN,
      reason,
    });
    await notifyFundraiser(tx, campaign, actor.userId, {
      title: "Suspension Dicabut",
      message: `Suspension atas Campaign "${campaign.title}" telah dicabut oleh Admin. Campaign kini ${STATUS_LABEL[to]}. Alasan: ${reason}`,
    });
    return { campaign: updated };
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
  const { campaignId, actor, urgent, now = new Date() } = params;
  requireAdminAssignment(actor, "Hanya Admin yang dapat memasang atau melepas Urgent.");
  const reason = requireReason(params.reason);
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    requireNotOwner(actor, campaign);
    const current = effectiveStatus(campaign, now);
    if (urgent && current !== CampaignStatus.ACTIVE) {
      throw new InvalidTransitionError(current);
    }
    const state = () =>
      tx.campaign.findUniqueOrThrow({ where: { id: campaign.id }, select: CAMPAIGN_STATE });
    if (campaign.isUrgent === urgent) {
      return { campaign: await state() };
    }
    // Predicated on both the status and the flag this command judged: if
    // another request moved the Campaign out of Active, or flipped the flag,
    // in between, nothing matches and this command loses.
    const written = await tx.campaign.updateMany({
      where: { id: campaign.id, lifecycleStatus: campaign.lifecycleStatus, isUrgent: !urgent },
      data: { isUrgent: urgent },
    });
    if (written.count === 0) throw new ConcurrentTransitionError();
    await tx.campaignStatusChange.create({
      data: {
        campaignId: campaign.id,
        action: urgent
          ? CampaignStatusChangeAction.URGENT_SET
          : CampaignStatusChangeAction.URGENT_CLEARED,
        fromStatus: null,
        toStatus: null,
        actorId: actor.userId,
        capacity: StatusChangeCapacity.ADMIN,
        reason,
      },
    });
    return { campaign: await state() };
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
  const { campaignId, actor, now = new Date() } = params;
  requireVerifierAssignment(actor, "Hanya Verifier yang dapat memasang Flag pada Campaign.");
  const reason = requireReason(params.reason);
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    // Lock first, then read. A Suspension's status write takes this row, so
    // the two serialise: either the Suspension commits first and this Flag
    // is refused, or this Flag commits first and the Suspension resolves it.
    // Without the lock a Flag could land open on a just-suspended Campaign,
    // after the sweep that would have resolved it.
    await lockCampaignRow(tx, campaignId);
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    requireNotOwner(actor, campaign, "Verifier");
    const current = effectiveStatus(campaign, now);
    if (!FLAGGABLE.includes(current)) {
      throw new InvalidTransitionError(current);
    }
    const flag = await tx.campaignFlag.create({
      data: { campaignId, verifierId: actor.userId, reason },
    });
    const updated = await tx.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: CAMPAIGN_STATE,
    });
    return { campaign: updated, flag };
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
  const { campaignId, flagId, actor, now = new Date() } = params;
  requireAdminAssignment(actor, "Hanya Admin yang dapat menolak Flag.");
  const reason = requireReason(params.reason);
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    // Lock first, then read: a Suspension resolving this Flag holds the same
    // row from its status write to its commit, so the check below sees
    // whatever that Suspension decided, and the two never both resolve it.
    await lockCampaignRow(tx, campaignId);
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    requireNotOwner(actor, campaign);
    const existing = await tx.campaignFlag.findUnique({ where: { id: flagId } });
    if (!existing || existing.campaignId !== campaignId) throw new FlagNotFoundError(flagId);
    if (existing.resolution !== null) {
      throw new FlagAlreadyResolvedError(existing.resolution);
    }
    // Predicated on the Flag still being open, like the Cancellation claim:
    // a second guard should a writer ever resolve Flags without the lock.
    const claimed = await tx.campaignFlag.updateMany({
      where: { id: flagId, resolution: null },
      data: {
        resolution: FlagResolution.DISMISSED,
        resolvedById: actor.userId,
        resolutionReason: reason,
        resolvedAt: now,
      },
    });
    if (claimed.count === 0) throw new ConcurrentTransitionError();
    const updated = await tx.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: CAMPAIGN_STATE,
    });
    const flag = await tx.campaignFlag.findUniqueOrThrow({ where: { id: flagId } });
    return { campaign: updated, flag };
  });
}
