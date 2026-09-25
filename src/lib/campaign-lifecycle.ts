import {
  Assignment,
  CampaignStatus,
  CampaignStatusChangeAction,
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
 * lifecycle state that is not one of the six known legacy values
 * must fail loudly, never silently land somewhere plausible.
 */
const STRING_TO_LIFECYCLE: Record<string, CampaignStatus> = {
  pending: CampaignStatus.SUBMITTED,
  active: CampaignStatus.ACTIVE,
  rejected: CampaignStatus.REJECTED,
  suspended: CampaignStatus.SUSPENDED,
  completed: CampaignStatus.COMPLETED,
  expired: CampaignStatus.EXPIRED,
};

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

type LifecycleErrorCode =
  | "VALIDATION"
  | "NOT_AUTHORIZED"
  | "OWN_CAMPAIGN_CONFLICT"
  | "SAME_ADMIN_LIFT"
  | "CAMPAIGN_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONCURRENT_TRANSITION"
  | "PAYOUT_ALREADY_COMPLETED"
  | "CANCELLATION_ALREADY_PENDING"
  | "MISSING_CAMPAIGN_UPDATE";

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

/** An Admin tried to act as Admin on a Campaign they own. */
export class OwnCampaignConflictError extends CampaignLifecycleError {
  readonly code = "OWN_CAMPAIGN_CONFLICT";
  constructor() {
    super(
      "Anda tidak dapat bertindak sebagai Admin atas Campaign milik Anda sendiri. Tindakan ini harus dilakukan Admin lain."
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

export type LifecycleActor = {
  userId: string;
  assignments: readonly Assignment[];
};

export type LifecycleResult = {
  campaign: {
    id: string;
    slug: string;
    lifecycleStatus: CampaignStatus;
    isUrgent: boolean;
  };
};

type Tx = Prisma.TransactionClient;

type CampaignForTransition = {
  id: string;
  slug: string;
  lifecycleStatus: CampaignStatus;
  isUrgent: boolean;
};

async function transition(
  tx: Tx,
  campaign: CampaignForTransition,
  change: {
    to: CampaignStatus;
    action: CampaignStatusChangeAction;
    actorId: string | null;
    capacity: StatusChangeCapacity;
    reason?: string | null;
  }
): Promise<void> {
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
}

/**
 * Everything that must happen, in the same transaction, whenever a
 * Campaign stops being Active, whatever the exit. Urgent only means
 * something for a Campaign that can still take a Donation, so it drops
 * here and never comes back on its own (a lifted Suspension does not
 * restore it). Cancellation requests (ticket 07) lapse here too.
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
}

/**
 * The in-app Notification to the Campaign's creator, sent only when someone
 * else made the change: a Fundraiser is never told about their own action.
 */
async function notifyCreator(
  tx: Tx,
  campaign: { creatorId: string; slug: string },
  actorId: string | null,
  notification: { type: string; title: string; message: string }
): Promise<void> {
  if (actorId === campaign.creatorId) return;
  await tx.notification.create({
    data: {
      ...notification,
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
    await notifyCreator(tx, campaign, null, {
      type: "campaign_status",
      title: "Campaign Berakhir",
      message: `Tenggat Campaign "${campaign.title}" telah lewat. Campaign kini Expired dan tidak lagi menerima donasi.`,
    });
    return true;
  });
}

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

export async function decideSubmission(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    decision: "approve" | "reject";
    now?: Date;
  }
): Promise<LifecycleResult> {
  const { campaignId, actor, now = new Date() } = params;
  const decision = SUBMISSION_DECISIONS[params.decision];
  if (!actor.assignments.includes(Assignment.VERIFIER)) {
    throw new NotAuthorizedError(
      "Hanya Verifier yang dapat menyetujui atau menolak Campaign."
    );
  }
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    const current = effectiveStatus(campaign, now);
    if (current !== CampaignStatus.SUBMITTED) {
      throw new InvalidTransitionError(current);
    }
    const to = decision.to;
    await transition(tx, campaign, {
      to,
      action: decision.action,
      actorId: actor.userId,
      capacity: StatusChangeCapacity.VERIFIER,
    });
    await notifyCreator(tx, campaign, actor.userId, {
      type: "campaign_moderation",
      title: decision.title,
      message: decision.message(campaign.title),
    });
    return {
      campaign: {
        id: campaign.id,
        slug: campaign.slug,
        lifecycleStatus: to,
        isUrgent: campaign.isUrgent,
      },
    };
  });
}
