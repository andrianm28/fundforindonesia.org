import {
  Assignment,
  CampaignStatus,
  CampaignStatusChangeAction,
  CancellationRequestStatus,
  FlagResolution,
  PayoutStatus,
  StatusChangeCapacity,
  VerificationOutcome,
  VerificationRequestKind,
  type Kind,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  collectingEntityBlock,
  type CollectingEntityBlock,
  type KindAuthorisationWindow,
  type PermitWindow,
} from "./collecting-entity";
import { readUserEmail, SELECT_USER_EMAIL } from "./contact-fields";

/** What the donation gate reads of a Campaign (select COLLECTING_ENTITY_SELECT for the entity). */
type DonationGateCampaign = {
  lifecycleStatus: CampaignStatus;
  deadline: Date | null;
  kind: Kind;
  collectingEntity: {
    permits: readonly PermitWindow[];
    kindAuthorisations: readonly KindAuthorisationWindow[];
  } | null;
};

/**
 * Single enforcement point for "only ACTIVE accepts a Donation", and only
 * while its Collecting Entity holds a Fundraising Permit valid now for its
 * Kind (prd-compliance 10, ADR 0010). POST /api/donations is the only
 * caller. The gate reads the enum that writers maintain, never the legacy
 * string. It judges the effective status, so an Active Campaign past its
 * deadline is refused before anyone has recorded it Expired; the caller runs
 * `expireIfPastDeadline` to record it. The permit is judged the same lazy
 * way: nothing is written when it lapses, the gate just stops passing.
 */
export function campaignAcceptsDonations(campaign: DonationGateCampaign, now: Date): boolean {
  return effectiveStatus(campaign, now) === CampaignStatus.ACTIVE && collectingEntityBlock(campaign, now) === null;
}

/**
 * Why an effectively Active Campaign refuses a Donation because of its
 * Collecting Entity, for the donate page's banner; null when it accepts one,
 * and null when it is not effectively Active, where the status is the reason.
 */
export function donationBlock(campaign: DonationGateCampaign, now: Date): CollectingEntityBlock | null {
  if (effectiveStatus(campaign, now) !== CampaignStatus.ACTIVE) return null;
  return collectingEntityBlock(campaign, now);
}

// ==================== Typed errors ====================

export * from "./campaign-lifecycle-errors";
// Raised by the Admin and Verifier commands through the Capacity judgement.
export { OwnSubjectConflictError } from "./capacity";
import {
  CampaignLifecycleError,
  CampaignNotFoundError,
  ConcurrentTransitionError,
  InvalidTransitionError,
  LifecycleValidationError,
  MissingCampaignUpdateError,
  PayoutAlreadyCompletedError,
  CancellationAlreadyPendingError,
  DeadlineRequiredError,
  SameAdminLiftError,
  STATUS_LABEL,
  CollectingEntityAlreadySetError,
} from "./campaign-lifecycle-errors";
import { missingRequiredDeadline } from "./campaign-kind";
import { organisationOf, requireOpenable, resolveCollectingEntity } from "./collecting-entity-guard";
import { activeCampaignCountsByFundraiser, resolveAbuseThresholds } from "./abuse-thresholds";
import { judgeCapacity, requireAssignmentFor, type RequestedCapacity } from "./capacity";
import { effectiveStatus, lockAndLoad } from "./subject-guard";
import { SUBMITTABLE_STATUSES } from "./verification-submission";
import { sendReportingFailure, type Mailer, type MailMessage } from "./mail";
import { verificationOutcomeEmail } from "./mail/verification-outcome";
import { publicUrl } from "./public-url";

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
    data: { lifecycleStatus: change.to },
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

/** A free-text field a command takes: the body field it came from, and its name in a refusal. */
type TextField = { field: string; label: string };

const REASON: TextField = { field: "reason", label: "Alasan" };

/** A required text: trimmed, non-empty, at most REASON_MAX_LENGTH characters. */
function requireReason(raw: unknown, text: TextField = REASON): string {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason === "") {
    throw new LifecycleValidationError(`${text.label} wajib diisi.`, text.field);
  }
  if (reason.length > REASON_MAX_LENGTH) {
    throw new LifecycleValidationError(
      `${text.label} maksimal ${REASON_MAX_LENGTH} karakter.`,
      text.field
    );
  }
  return reason;
}

/** An optional text: absent or blank is none; anything else must pass requireReason. */
function optionalReason(raw: unknown, text: TextField = REASON): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  return requireReason(raw, text);
}

/**
 * Who may run a command, and the capacity it is recorded in: the Capacity
 * the command asks for, judged by ./capacity.ts once the Campaign is read.
 * An ADMIN or VERIFIER request's assignment is checked before anything is
 * read. `message` is the refusal for anyone not authorized.
 */
type Authority = { capacity: RequestedCapacity; message: string };

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
 * The Payout guarantee is only as strong as its writer, and its writer
 * exists: completePayout (src/lib/money/payouts.ts) is what marks a Payout
 * COMPLETED, and it takes this same Campaign row lock through the same
 * guard before its status write. So the check below and that write cannot
 * interleave -- no Payout can complete between "none completed" and
 * CANCELLED.
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
 *      not found; who is acting (the Capacity judgement, ./capacity.ts,
 *      then a capacity-dependent reason); the allowed
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
  requireAssignmentFor(actor, authority.capacity, authority.message);
  let reason: string | null =
    command.reasonPolicy === "required" ? requireReason(command.rawReason) : null;
  await expireIfPastDeadline(prisma, campaignId, now);
  return prisma.$transaction(async (tx) => {
    const campaign = await lockAndRead(tx, campaignId, now);
    if (!campaign) throw new CampaignNotFoundError(campaignId);
    const capacity = judgeCapacity(
      { kind: "campaign", ownerId: campaign.creatorId },
      actor,
      authority.capacity,
      authority.message
    );
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

// ==================== Verification Request (verification-request 01) ====================

/** One checklist item as a Verification Request keeps it: the item at submission, and the Verifier's tick. */
export type ChecklistEntry = {
  id: string;
  label: string;
  required: boolean;
  position: number;
  ticked: boolean;
};

/**
 * The active checklist a submission snapshots: the general ("Semua") items
 * plus the Campaign Kind's own (PRD §7.1), in position order, none ticked.
 * Shared by submissions from Draft/Rejected and by change requests on an
 * Active Campaign, so both are judged against the same list.
 */
async function snapshotChecklist(tx: Tx, kind: Kind): Promise<ChecklistEntry[]> {
  const items = await tx.verificationChecklistItem.findMany({
    where: { active: true, OR: [{ kind: null }, { kind }] },
    orderBy: { position: "asc" },
  });
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    required: item.required,
    position: item.position,
    ticked: false,
  }));
}

export type VerificationRequestState = {
  id: string;
  campaignId: string;
  /** Null on an AMOUNT_REVIEW: the System raises that one, no person submits it. */
  submittedById: string | null;
  submittedAt: Date;
  checklist: Prisma.JsonValue;
  outcome: VerificationOutcome;
  reason: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  isFirst: boolean;
  kind: VerificationRequestKind;
  /** The Gross and threshold behind an AMOUNT_REVIEW; null on the other kinds. */
  raisedByAmount: Prisma.JsonValue;
};

export type SubmissionResult = LifecycleResult & { verificationRequest: VerificationRequestState };

/**
 * The Fundraiser submits their Draft or Rejected Campaign to a Verifier
 * (FFI-04, FFI-05). The Campaign becomes Submitted and a new PENDING
 * Verification Request opens, holding a snapshot of the active checklist
 * items for its Kind (the "Semua" items plus its Kind's own, PRD §7.1),
 * none ticked, so a later edit of the checklist never
 * changes what this request is judged against. A Draft's submission is the
 * Campaign's first request; a Rejected one's is a resubmission. A Campaign
 * whose Kind needs a deadline and has none is refused, and so is one that
 * may not open (prd-compliance 10, ADR 0010): no Collecting Entity, one this
 * Fundraiser may not collect under, or one holding no Fundraising Permit
 * valid now for its Kind. A Draft of an organisation's linked account that
 * names none gets that organisation here. The request records the
 * Collecting Entity it was submitted under. Only its
 * Fundraiser may submit, and always in that Capacity, even holding ADMIN or
 * VERIFIER; nobody is notified, since the Fundraiser is the one acting.
 */
export async function submitCampaign(
  prisma: PrismaClient,
  params: { campaignId: string; actor: LifecycleActor; now?: Date }
): Promise<SubmissionResult> {
  return runCommand(prisma, params, {
    authority: {
      capacity: StatusChangeCapacity.FUNDRAISER,
      message: "Hanya Fundraiser pemilik Campaign yang dapat mengajukannya ke Verifier.",
    },
    reasonPolicy: "none",
    allowedFrom: SUBMITTABLE_STATUSES,
    step: async ({ tx, campaign, current, actor, now, transition }) => {
      if (missingRequiredDeadline(campaign)) {
        throw new DeadlineRequiredError(campaign.kind);
      }
      // A Draft of an organisation's linked account that names no Collecting
      // Entity gets its organisation now, as it would have at creation.
      const collectingEntityId =
        campaign.collectingEntityId ?? (await organisationOf(tx, campaign.creatorId))?.id ?? null;
      await requireOpenable(tx, { ...campaign, collectingEntityId }, now, "diajukan");
      if (collectingEntityId !== campaign.collectingEntityId) {
        await tx.campaign.update({ where: { id: campaign.id }, data: { collectingEntityId } });
      }
      const checklist = await snapshotChecklist(tx, campaign.kind);
      const verificationRequest = await tx.verificationRequest.create({
        data: {
          campaignId: campaign.id,
          submittedById: actor.userId,
          submittedAt: now,
          checklist,
          isFirst: current === CampaignStatus.DRAFT,
          collectingEntityId,
          kind: VerificationRequestKind.SUBMISSION,
        },
      });
      await transition(CampaignStatus.SUBMITTED, CampaignStatusChangeAction.SUBMITTED);
      return { verificationRequest };
    },
  });
}

/** No such request on this Campaign (a request is always addressed through its Campaign). */
export class VerificationRequestNotFoundError extends CampaignLifecycleError {
  readonly code = "VERIFICATION_REQUEST_NOT_FOUND";
  constructor(readonly requestId: string) {
    super("Verification Request tidak ditemukan.");
    this.name = "VerificationRequestNotFoundError";
  }
}

/**
 * The Verifier tried to loloskan a request while required items of its own
 * checklist snapshot were unticked (CONTEXT.md, Verification Request).
 * `labels` lists them in checklist order. A rejection never raises it.
 */
export class RequiredChecklistItemsUntickedError extends CampaignLifecycleError {
  readonly code = "REQUIRED_CHECKLIST_ITEMS_UNTICKED";
  constructor(readonly labels: string[]) {
    super(`Campaign belum dapat diloloskan. Butir wajib yang belum dicentang: ${labels.join(", ")}.`);
    this.name = "RequiredChecklistItemsUntickedError";
  }
}

/** The request was already decided or withdrawn; a closed request is never changed again. */
export class VerificationRequestNotPendingError extends CampaignLifecycleError {
  readonly code = "VERIFICATION_REQUEST_NOT_PENDING";
  constructor(readonly outcome: VerificationOutcome) {
    super(
      outcome === VerificationOutcome.WITHDRAWN
        ? "Verification Request ini sudah ditarik oleh Fundraiser."
        : "Verification Request ini sudah diputuskan."
    );
    this.name = "VerificationRequestNotPendingError";
  }
}

/**
 * The Fundraiser already runs as many Active Campaigns as the limit allows,
 * so this approval would open one more (prd-compliance 38, PRD
 * §"Anti penyalahgunaan"; see the Active Campaign limit below).
 */
export class TooManyActiveCampaignsError extends CampaignLifecycleError {
  readonly code = "TOO_MANY_ACTIVE_CAMPAIGNS";
  constructor(
    readonly activeCampaigns: number,
    readonly limit: number
  ) {
    super(
      `Fundraiser sudah memiliki ${activeCampaigns} Campaign Active, yaitu batas ${limit}. Selesaikan, batalkan, atau biarkan tenggatnya lewat salah satunya sebelum Campaign ini diloloskan.`
    );
    this.name = "TooManyActiveCampaignsError";
  }
}

/**
 * The Active Campaign limit (prd-compliance 38, PRD §"Anti penyalahgunaan":
 * "batas tiga Campaign Active sebelum Usage Report pertama"), enforced where
 * it can be: on the approval that would open one more.
 *
 * The PRD's escape is the Fundraiser's first Usage Report, and no Usage
 * Report exists in this schema yet (prd-compliance 29), so today the only way
 * a fourth Active Campaign becomes possible is for one of the first three to
 * leave Active on its own -- reach its deadline, be Completed, be Cancelled,
 * be Suspended. That is why the refusal names those and does not name a Usage
 * Report, and why the count is of Active Campaigns rather than of Campaigns
 * ever created. Campaigns already collecting are never touched by this: no
 * Donation is held, no Campaign is closed, and only the new one waits.
 *
 * A Demo Campaign does not count, and a Campaign past its deadline has
 * already stopped counting: both are decided by
 * activeCampaignCountsByFundraiser, the one place this rule's arithmetic
 * lives, which the Admin's scrutiny view reads too.
 *
 * THE RACE, STATED PLAINLY. The count is read under this Campaign's row lock,
 * which is not the same lock as a sibling Campaign of the same Fundraiser, so
 * two approvals committed at the same moment can both see two Active Campaigns
 * and both open a third. The outcome is one extra Active Campaign, never a
 * wrong count and never money moving; locking the Fundraiser's User row would
 * close it, and is deliberately not done here because nothing else in this
 * module locks a User and a second lock order is a worse trade than the race.
 * The limit is a ceiling on parallel appeals, not an accounting rule.
 */
async function requireWithinActiveCampaignLimit(
  tx: Tx,
  params: { campaignId: string; fundraiserId: string; now: Date }
): Promise<void> {
  const { campaignId, fundraiserId, now } = params;
  const { activeCampaignsPerFundraiser: limit } = await resolveAbuseThresholds(tx);
  const counts = await activeCampaignCountsByFundraiser(tx, {
    now,
    excludeCampaignId: campaignId,
    fundraiserId,
  });
  const active = counts.get(fundraiserId) ?? 0;
  if (active >= limit) throw new TooManyActiveCampaignsError(active, limit);
}

/**
 * The PENDING request `requestId` of this Campaign, read under its row lock.
 * The request is judged before the Campaign's status, so a missing, decided
 * or withdrawn request answers as such whatever the Campaign's status; a
 * pending one is only acted on while the Campaign still holds the status it
 * was opened from: Submitted for a submission, Active for a change request
 * (ticket 12), which an Active Campaign keeps running throughout.
 *
 * An AMOUNT_REVIEW (prd-compliance 38) is judged in every status, and that is
 * the point of it: the money arrived while the Campaign was Active, and it
 * may be Expired, Suspended or Completed by the time a Verifier gets to it.
 * Refusing the decision because the Campaign has since closed would leave the
 * review permanently undecidable, which is how an unreviewed Campaign stays
 * unreviewed.
 */
async function readPendingRequest(tx: Tx, campaignId: string, requestId: string, current: CampaignStatus) {
  const request = await tx.verificationRequest.findUnique({ where: { id: requestId } });
  if (!request || request.campaignId !== campaignId) {
    throw new VerificationRequestNotFoundError(requestId);
  }
  if (request.outcome !== VerificationOutcome.PENDING) {
    throw new VerificationRequestNotPendingError(request.outcome);
  }
  if (request.kind === VerificationRequestKind.AMOUNT_REVIEW) return request;
  const openedFrom = isChangeRequest(request) ? CampaignStatus.ACTIVE : CampaignStatus.SUBMITTED;
  if (current !== openedFrom) throw new InvalidTransitionError(current);
  return request;
}

/**
 * A change request asks an Active Campaign's Verifier to approve a new target
 * and/or deadline; the Campaign keeps running on its old values until then,
 * and holds no other status for the request's life. Which of the three kinds
 * of request this is, is the `kind` column (prd-compliance 38); the proposal
 * itself is still read off `proposedChanges`, which only a CHANGE carries.
 */
function isChangeRequest(request: { kind: VerificationRequestKind }): boolean {
  return request.kind === VerificationRequestKind.CHANGE;
}

/**
 * The proposal a CHANGE carries, narrowed from its JSON column. Empty rather
 * than undefined when the column is somehow null, so applying it writes
 * nothing instead of throwing mid-decision: a CHANGE with no proposal is a row
 * the migration could not produce, and a decision must not die on it.
 */
function proposedChangesOf(request: { proposedChanges: unknown }): ProposedChanges {
  return (request.proposedChanges ?? {}) as ProposedChanges;
}

/**
 * Writes an approved proposal onto the Active Campaign. Only the keys the
 * Fundraiser named are written, so a deadline-only request leaves the target
 * alone; a null deadline clears it, which the Kind's own rule about a
 * required deadline was already checked against at request time.
 */
async function applyProposedChanges(tx: Tx, campaignId: string, proposed: ProposedChanges): Promise<void> {
  const data: Prisma.CampaignUpdateManyMutationInput = {};
  if (proposed.targetAmount !== undefined) data.targetAmount = proposed.targetAmount;
  if (proposed.deadline !== undefined) {
    data.deadline = proposed.deadline === null ? null : new Date(proposed.deadline);
  }
  if (Object.keys(data).length === 0) return;
  await tx.campaign.updateMany({ where: { id: campaignId }, data });
}

/**
 * Closes a request, by a decision or a withdrawal. The write matches PENDING
 * rows only, so a closed request is never written again.
 */
async function closeRequest(
  tx: Tx,
  requestId: string,
  closed: Prisma.VerificationRequestUpdateManyMutationInput
): Promise<void> {
  const written = await tx.verificationRequest.updateMany({
    where: { id: requestId, outcome: VerificationOutcome.PENDING },
    data: closed,
  });
  if (written.count === 0) throw new ConcurrentTransitionError();
}

const VERIFICATION_DECISIONS = {
  approve: {
    to: CampaignStatus.ACTIVE,
    outcome: VerificationOutcome.APPROVED,
    action: CampaignStatusChangeAction.SUBMISSION_APPROVED,
    reasonPolicy: "none",
    title: "Campaign Diloloskan",
    message: (title: string) =>
      `Campaign "${title}" diloloskan Verifier dan kini aktif menerima donasi.`,
  },
  reject: {
    to: CampaignStatus.REJECTED,
    outcome: VerificationOutcome.REJECTED,
    action: CampaignStatusChangeAction.SUBMISSION_REJECTED,
    reasonPolicy: "required",
    title: "Campaign Ditolak",
    message: (title: string, reason: string | null) =>
      `Campaign "${title}" ditolak oleh Verifier. Perbaiki Campaign Anda, lalu ajukan kembali. Alasan: ${reason}`,
  },
} as const;

export type VerificationDecision = keyof typeof VERIFICATION_DECISIONS;

/** Which way a Verifier settled a request, as the change-request wording needs it. */
function changeKey(outcome: VerificationOutcome): "approved" | "rejected" {
  return outcome === VerificationOutcome.APPROVED ? "approved" : "rejected";
}

const CHANGE_TITLES = {
  approved: "Perubahan Campaign Disetujui",
  rejected: "Perubahan Campaign Ditolak",
} as const;

function changeMessage(key: "approved" | "rejected", title: string, reason: string | null): string {
  return key === "approved"
    ? `Perubahan target atau tenggat Campaign "${title}" disetujui Verifier dan sudah berlaku.`
    : `Perubahan target atau tenggat Campaign "${title}" ditolak oleh Verifier. Campaign tetap berjalan dengan target dan tenggat sebelumnya. Alasan: ${reason}`;
}

/**
 * The Fundraiser's wording for a decided Verifikasi Tambahan
 * (prd-compliance 38). Deliberately says what did not happen: the Campaign
 * is untouched and still taking Donations either way, because the review
 * exists to look at the money, not to punish the Fundraiser for having
 * received it. On a rejection the Verifier's reason is carried, since a
 * reason nobody is told is a decision with no reader.
 */
const AMOUNT_REVIEW_TITLES = {
  approved: "Verifikasi Tambahan Selesai",
  rejected: "Verifikasi Tambahan Mencatat Kekhawatiran",
} as const;

function amountReviewMessage(key: "approved" | "rejected", title: string, reason: string | null): string {
  return key === "approved"
    ? `Campaign "${title}" telah ditinjau ulang Verifier karena dana terkumpulnya besar. Campaign tetap berjalan seperti sebelumnya.`
    : `Verifier mencatat kekhawatiran pada Campaign "${title}" setelah dana terkumpulnya besar. Campaign tetap berjalan dan tidak ada tindakan otomatis yang diambil. Alasan: ${reason}`;
}

export function isVerificationDecision(value: unknown): value is VerificationDecision {
  return typeof value === "string" && Object.hasOwn(VERIFICATION_DECISIONS, value);
}

/** The ticked checklist item ids: absent is none; otherwise an array of strings. */
function parseTicked(raw: unknown): Set<string> {
  if (raw === undefined || raw === null) return new Set();
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) {
    throw new LifecycleValidationError("Checklist tidak valid.", "ticked");
  }
  return new Set(raw);
}

const IDENTITY_NOTE: TextField = { field: "identityNote", label: "Catatan identitas" };

export type VerificationDecisionResult = LifecycleResult & {
  verificationRequest: VerificationRequestState;
  /** Whether this approval is the one that recorded the Fundraiser's Identity Verification. */
  identityVerificationRecorded: boolean;
};

/**
 * A Verifier decides a PENDING Verification Request (FFI-05): approve makes
 * the Submitted Campaign Active; reject makes it Rejected, with a required
 * reason. The Verifier's ticks are recorded on the request's own checklist
 * snapshot, beside the outcome, reason, Verifier and time. Only a request
 * with every required item of that snapshot ticked may be diloloskan; a
 * rejection needs none. Approving also confirms the Collecting Entity
 * (prd-compliance 10): it must still be one the Fundraiser may collect
 * under, holding a Fundraising Permit valid now for the Kind, or the
 * approval is refused and the request stays pending. Recorded in the
 * VERIFIER Capacity; a Verifier never decides on a Campaign they own.
 *
 * The request is judged before the Campaign's status, so a decided or
 * withdrawn request answers as such. A decided request is never written
 * again: the write is predicated on PENDING, under the Campaign row lock.
 *
 * Approving records the Fundraiser's Identity Verification when they have
 * none yet (CONTEXT.md, Identity Verification), with this Verifier, `now`
 * and the optional note; an existing one is left as it is. The Fundraiser is
 * told the outcome, and on rejection the reason: in-app, in the same
 * transaction, and by email once it has committed.
 *
 * The email is sent after commit and never inside the transaction: sent
 * before commit, a rollback would leave the Fundraiser told of a decision
 * that never happened, and a slow relay would hold the Campaign row lock.
 * Neither a failed send nor a Mailer left unconfigured undoes or refuses
 * the decision: each is logged for an operator (sendReportingFailure:
 * `mail_send_failed`, `mail_not_configured`), and the in-app Notification,
 * committed with the decision, still tells the Fundraiser. `mailer` is for
 * tests; routes use the configured one.
 */
export async function decideVerificationRequest(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    requestId: string;
    actor: LifecycleActor;
    decision: VerificationDecision;
    ticked?: unknown;
    reason?: unknown;
    identityNote?: unknown;
    now?: Date;
    mailer?: Mailer;
  }
): Promise<VerificationDecisionResult> {
  const { requestId } = params;
  const decision = VERIFICATION_DECISIONS[params.decision];
  const ticked = parseTicked(params.ticked);
  const identityNote = optionalReason(params.identityNote, IDENTITY_NOTE);
  // Composed under the lock from what was decided; sent only after commit.
  // Kept out of the command's result, which the route returns as JSON: the
  // Fundraiser's address has no business in the Verifier's response.
  const outcome: { email?: MailMessage; fundraiserId?: string } = {};
  const result = await runCommand(prisma, params, {
    authority: {
      capacity: StatusChangeCapacity.VERIFIER,
      message: "Hanya Verifier yang dapat menyetujui atau menolak Campaign.",
    },
    reasonPolicy: decision.reasonPolicy,
    rawReason: params.reason,
    step: async ({ tx, campaign, current, actor, reason, now, transition, notify }) => {
      const request = await readPendingRequest(tx, campaign.id, requestId, current);
      const snapshot = request.checklist as ChecklistEntry[];
      const known = new Set(snapshot.map((entry) => entry.id));
      if (Array.from(ticked).some((id) => !known.has(id))) {
        throw new LifecycleValidationError(
          "Checklist memuat item yang tidak ada pada pengajuan ini.",
          "ticked"
        );
      }
      const checklist: ChecklistEntry[] = snapshot.map((entry) => ({
        ...entry,
        ticked: ticked.has(entry.id),
      }));
      if (decision.outcome === VerificationOutcome.APPROVED) {
        const unticked = checklist.filter((entry) => entry.required && !entry.ticked);
        if (unticked.length > 0) {
          throw new RequiredChecklistItemsUntickedError(unticked.map((entry) => entry.label));
        }
        // Approving confirms the Collecting Entity the Campaign was submitted
        // under (frozen since), so it must still be one this Fundraiser may
        // collect under, holding a permit valid now for the Kind (ADR 0010).
        // An AMOUNT_REVIEW is approved on the same terms, even though nobody
        // submitted it: passing it says the Campaign's collecting arrangement
        // is still sound as of now, which is the question a large Campaign
        // raises anyway.
        await requireOpenable(tx, campaign, now, "diloloskan");
        // ...and the approval must not open more Active Campaigns than one
        // Fundraiser may run (prd-compliance 38). Counted here, where the
        // decision is taken, so the refusal is a refusal rather than an
        // approval somebody has to undo.
        if (request.kind === VerificationRequestKind.SUBMISSION) {
          await requireWithinActiveCampaignLimit(tx, {
            campaignId: campaign.id,
            fundraiserId: campaign.creatorId,
            now,
          });
        }
      }
      const decided = {
        checklist,
        outcome: decision.outcome,
        reason,
        decidedById: actor.userId,
        decidedAt: now,
      };
      await closeRequest(tx, requestId, decided);
      if (request.kind === VerificationRequestKind.AMOUNT_REVIEW) {
        // An amount review decides nothing about the Campaign: it was not
        // asked to change and must not be closed by the answer. A Verifier
        // who is not satisfied raises a Flag (below), which is the one
        // record that asks an Admin to consider Suspension.
      } else if (isChangeRequest(request)) {
        // A change request never moves the Campaign: it stays Active on its
        // old values either way, so approving only writes the proposal onto
        // the row and logs no status change (ticket 12).
        if (decision.outcome === VerificationOutcome.APPROVED) {
          await applyProposedChanges(tx, campaign.id, proposedChangesOf(request));
        }
      } else {
        await transition(decision.to, decision.action);
      }
      let identityVerificationRecorded = false;
      if (decision.outcome === VerificationOutcome.APPROVED) {
        // Two Campaigns of one Fundraiser hold different row locks, so two
        // approvals may race here; the unique userId keeps the first.
        const created = await tx.identityVerification.createMany({
          data: [
            { userId: campaign.creatorId, verifierId: actor.userId, verifiedAt: now, note: identityNote },
          ],
          skipDuplicates: true,
        });
        identityVerificationRecorded = created.count > 0;
      }
      const changeRequest = isChangeRequest(request);
      const amountReview = request.kind === VerificationRequestKind.AMOUNT_REVIEW;
      await notify({
        title: amountReview
          ? AMOUNT_REVIEW_TITLES[changeKey(decision.outcome)]
          : changeRequest
            ? CHANGE_TITLES[changeKey(decision.outcome)]
            : decision.title,
        message: amountReview
          ? amountReviewMessage(changeKey(decision.outcome), campaign.title, reason)
          : changeRequest
            ? changeMessage(changeKey(decision.outcome), campaign.title, reason)
            : decision.message(campaign.title, reason),
      });
      // No email for an amount review: nothing about the Fundraiser's
      // Campaign changed and nothing is asked of them, so an email saying
      // so would only teach people to ignore this address. The in-app
      // notification above already tells them their Campaign was looked at
      // again, and why.
      if (!amountReview) {
        const fundraiser = await tx.user.findUniqueOrThrow({
          where: { id: campaign.creatorId },
          select: { name: true, ...SELECT_USER_EMAIL },
        });
        const fundraiserEmail = readUserEmail(fundraiser);
        if (!fundraiserEmail) {
          throw new Error(
            `Cannot email the verification outcome to the Fundraiser of ${campaign.slug}: their account has no readable email address (ADR 0012)`,
          );
        }
        outcome.fundraiserId = campaign.creatorId;
        outcome.email = verificationOutcomeEmail({
          to: fundraiserEmail,
          fundraiserName: fundraiser.name,
          campaignTitle: campaign.title,
          campaignUrl: publicUrl(`/campaign/${campaign.slug}`),
          ...(changeRequest ? { kind: "change" as const } : {}),
          ...(decision.outcome === VerificationOutcome.APPROVED
            ? { outcome: "approved" as const }
            : { outcome: "rejected" as const, reason: requireReason(reason) }),
        });
      }
      return { verificationRequest: { ...request, ...decided }, identityVerificationRecorded };
    },
  });
  if (outcome.email && outcome.fundraiserId) {
    await sendReportingFailure(
      outcome.email,
      {
        mail: "verification_outcome",
        campaignId: params.campaignId,
        verificationRequestId: requestId,
        userId: outcome.fundraiserId,
      },
      params.mailer
    );
  }
  return result;
}

/** The Campaign and the request as a withdrawal leaves them; the same shape a submission returns. */
export type WithdrawalResult = SubmissionResult;

/** A Verifikasi Tambahan is the System's, so the Fundraiser cannot withdraw it (prd-compliance 38). */
export class AmountReviewNotWithdrawableError extends CampaignLifecycleError {
  readonly code = "AMOUNT_REVIEW_NOT_WITHDRAWABLE";
  constructor() {
    super(
      "Verifikasi Tambahan tidak dapat ditarik oleh Fundraiser. Permintaan ini dibuka platform karena akumulasi dana Campaign yang besar, dan hanya Verifier yang dapat menutupnya."
    );
    this.name = "AmountReviewNotWithdrawableError";
  }
}

/**
 * The Fundraiser withdraws their undecided Verification Request (CONTEXT.md,
 * Verification Request). The request becomes WITHDRAWN, recording the
 * Fundraiser and `now` as who closed it and when, and the Campaign leaves
 * Submitted: back to Draft if this was its first request, back to Rejected
 * if it was a resubmission. Only its Fundraiser may withdraw, always in that
 * Capacity; nobody is notified, since the Fundraiser is the one acting.
 *
 * A Verifikasi Tambahan is refused here (prd-compliance 38): it was raised
 * because the Campaign crossed an amount, and letting the person whose money
 * it is withdraw the review would make the whole rule advisory.
 *
 * It races a Verifier's decision for the same Campaign row lock, so exactly
 * one of the two closes the request; the other finds it no longer pending.
 */
export async function withdrawVerificationRequest(
  prisma: PrismaClient,
  params: { campaignId: string; requestId: string; actor: LifecycleActor; now?: Date }
): Promise<WithdrawalResult> {
  const { requestId } = params;
  return runCommand(prisma, params, {
    authority: {
      capacity: StatusChangeCapacity.FUNDRAISER,
      message: "Hanya Fundraiser pemilik Campaign yang dapat menarik pengajuannya.",
    },
    reasonPolicy: "none",
    step: async ({ tx, campaign, current, actor, now, transition }) => {
      const request = await readPendingRequest(tx, campaign.id, requestId, current);
      if (request.kind === VerificationRequestKind.AMOUNT_REVIEW) {
        throw new AmountReviewNotWithdrawableError();
      }
      const withdrawn = {
        outcome: VerificationOutcome.WITHDRAWN,
        decidedById: actor.userId,
        decidedAt: now,
      };
      await closeRequest(tx, requestId, withdrawn);
      // A withdrawn change request discards the proposal only: the Campaign
      // keeps running Active on its old values, so no status change is
      // logged (ticket 12). A withdrawn submission returns to Draft or
      // Rejected, which is what the Fundraiser is told.
      const to = isChangeRequest(request) ? null : request.isFirst ? CampaignStatus.DRAFT : CampaignStatus.REJECTED;
      if (to !== null) await transition(to, CampaignStatusChangeAction.SUBMISSION_WITHDRAWN);
      // The spec's withdraw confirmation: the one lifecycle notice a
      // Fundraiser gets for their own action, so it bypasses `notify`.
      await tx.notification.create({
        data: {
          type: "campaign_status",
          userId: campaign.creatorId,
          link: `/campaign/${campaign.slug}`,
          title: to === null ? "Pengajuan Perubahan Ditarik" : "Pengajuan Ditarik",
          message:
            to === null
              ? `Pengajuan perubahan Campaign "${campaign.title}" telah ditarik. Campaign tetap aktif dengan target dan tenggat sebelumnya.`
              : `Pengajuan Campaign "${campaign.title}" ke Verifier telah ditarik. Campaign kini ${STATUS_LABEL[to]} dan dapat diedit lalu diajukan kembali.`,
        },
      });
      return { verificationRequest: { ...request, ...withdrawn } };
    },
  });
}

// ==================== Change requests on an Active Campaign (ticket 12) ====================

/** A second change asked while an earlier request still waits for a Verifier. */
export class ChangeRequestAlreadyPendingError extends CampaignLifecycleError {
  readonly code = "CHANGE_REQUEST_ALREADY_PENDING";
  constructor() {
    super("Masih ada Verification Request yang menunggu keputusan Verifier untuk Campaign ini.");
    this.name = "ChangeRequestAlreadyPendingError";
  }
}

/**
 * The new target and/or deadline an Active Campaign asks for (PRD FFI-05).
 * Only the keys the Fundraiser named are present. The deadline is the ISO
 * string the Fundraiser sent, so the request row shows exactly what was
 * asked; approving parses it back onto the Campaign.
 */
export type ProposedChanges = {
  targetAmount?: number;
  deadline?: string | null;
};

const TARGET_AMOUNT: TextField = { field: "targetAmount", label: "Target donasi" };
const DEADLINE: TextField = { field: "deadline", label: "Tenggat" };

/** A target amount: a positive whole rupiah, like POST /api/campaigns asks. */
function parseTargetAmount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new LifecycleValidationError("Target donasi harus lebih dari 0.", TARGET_AMOUNT.field);
  }
  return raw;
}

/** A deadline: an ISO datetime string or Date, or null to clear it. */
function parseDeadline(raw: unknown): Date | null {
  if (raw === null) return null;
  const date = typeof raw === "string" || raw instanceof Date ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new LifecycleValidationError("Tenggat tidak valid.", DEADLINE.field);
  }
  return date;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return a?.getTime() === b?.getTime();
}

/**
 * The Fundraiser of an Active Campaign asks for a new target and/or deadline
 * (CONTEXT.md, Verification Request; PRD FFI-05). A new PENDING Verification
 * Request opens, holding the per-Kind checklist snapshot and the proposed
 * values; the Campaign itself is untouched, so it stays Active and keeps
 * taking Donations on its old values until a Verifier approves. Refused
 * while another request on the Campaign is still PENDING, and refused when
 * the proposal changes nothing or leaves the Campaign's Kind without the
 * deadline it needs. Only its Fundraiser may ask, always in that Capacity;
 * nobody is notified, since the Fundraiser is the one acting.
 */
export async function requestCampaignChange(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    changes: { targetAmount?: unknown; deadline?: unknown };
    now?: Date;
  }
): Promise<SubmissionResult> {
  const { changes } = params;
  return runCommand(prisma, params, {
    authority: {
      capacity: StatusChangeCapacity.FUNDRAISER,
      message: "Hanya Fundraiser pemilik Campaign yang dapat mengajukan perubahan.",
    },
    reasonPolicy: "none",
    allowedFrom: [CampaignStatus.ACTIVE],
    step: async ({ tx, campaign, actor, now }) => {
      const targetAmount = changes.targetAmount !== undefined ? parseTargetAmount(changes.targetAmount) : undefined;
      const deadline = changes.deadline !== undefined ? parseDeadline(changes.deadline) : undefined;
      const afterDeadline = deadline !== undefined ? deadline : campaign.deadline;
      if ((targetAmount === undefined || targetAmount === campaign.targetAmount) && sameInstant(afterDeadline, campaign.deadline)) {
        throw new LifecycleValidationError("Tidak ada perubahan pada target atau tenggat yang diajukan.");
      }
      if (missingRequiredDeadline({ kind: campaign.kind, deadline: afterDeadline })) {
        throw new DeadlineRequiredError(campaign.kind);
      }
      const pending = await tx.verificationRequest.count({
        where: { campaignId: campaign.id, outcome: VerificationOutcome.PENDING, kind: VerificationRequestKind.CHANGE },
      });
      if (pending > 0) throw new ChangeRequestAlreadyPendingError();
      const checklist = await snapshotChecklist(tx, campaign.kind);
      const proposedChanges: ProposedChanges = {
        ...(targetAmount !== undefined && { targetAmount }),
        ...(deadline !== undefined && { deadline: deadline?.toISOString() ?? null }),
      };
      const verificationRequest = await tx.verificationRequest.create({
        data: {
          campaignId: campaign.id,
          submittedById: actor.userId,
          submittedAt: now,
          checklist,
          isFirst: false,
          collectingEntityId: campaign.collectingEntityId,
          proposedChanges,
          kind: VerificationRequestKind.CHANGE,
        },
      });
      return { verificationRequest };
    },
  });
}

// ==================== Verifikasi Tambahan (prd-compliance 38) ====================

/**
 * Raises the extra Verifier review a Campaign earns by collecting (PRD
 * §"Anti penyalahgunaan", "akumulasi Gross di atas Rp100 juta per Campaign
 * memicu verifikasi tambahan Verifier"; CONTEXT.md, Verifikasi Tambahan).
 *
 * The System raises it, in the SYSTEM Capacity, because it is the arrival of
 * money that triggers it and not somebody looking at a queue -- a rule read
 * only while a Verifier opens a request would never fire at all, since a
 * Campaign's Cumulative Gross is 0 while it waits to be approved. The
 * settlement webhook calls this inside its own transaction, so the review and
 * the money that raised it commit together or not at all.
 *
 * It is a Verification Request of the third kind, so it lands in the Verifier's
 * existing queue and is decided through the existing decision path -- with
 * the same per-Kind checklist snapshot a submission takes, which is what
 * makes the "bukan duplikat" item apply to a large Campaign too. It moves no
 * status, notifies nobody, and cannot be withdrawn by the Fundraiser: a
 * Campaign is not being punished for the money it received, and a review the
 * person under review could cancel would not be one.
 *
 * At most one per Campaign, ever, checked under the Campaign row lock. Two
 * Donations settling at once can both see the threshold passed, and this is
 * what makes one of them raise nothing; the lock is the subject guard's, like
 * every other command here.
 *
 * Returns null when the Campaign is gone or already has one: money settling
 * is not a reason to fail a Settlement, and a duplicate review is a smaller
 * harm than a Donation left unrecorded.
 */
export async function raiseAmountReviewVerificationRequest(
  tx: Tx,
  params: { campaignId: string; cumulativeGross: number; threshold: number; now?: Date }
): Promise<VerificationRequestState | null> {
  const { campaignId, cumulativeGross, threshold } = params;
  const now = params.now ?? new Date();
  const campaign = await lockAndRead(tx, campaignId, now);
  if (!campaign) return null;
  const existing = await tx.verificationRequest.findFirst({
    where: { campaignId, kind: VerificationRequestKind.AMOUNT_REVIEW },
  });
  if (existing) return null;
  const checklist = await snapshotChecklist(tx, campaign.kind);
  return tx.verificationRequest.create({
    data: {
      campaignId,
      submittedById: null,
      submittedAt: now,
      checklist,
      isFirst: false,
      collectingEntityId: campaign.collectingEntityId,
      kind: VerificationRequestKind.AMOUNT_REVIEW,
      raisedByAmount: { cumulativeGross, threshold },
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
      capacity: "FUNDRAISER_OR_ADMIN",
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
      capacity: StatusChangeCapacity.FUNDRAISER,
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

// ==================== Collecting Entity (prd-compliance 10) ====================

/**
 * An Admin or Verifier names the Collecting Entity of an effectively Active
 * Campaign that has none (one that predates the Collecting Entity), with a
 * reason, never on a Campaign they own. Until then it refuses Donations
 * (campaignAcceptsDonations). The organisation must be one the Campaign's
 * Fundraiser may collect under (./collecting-entity-guard.ts). Nothing about
 * the status moves; the assignment is recorded in the status log
 * (COLLECTING_ENTITY_ASSIGNED) in the Capacity acted in, Verifier when the
 * person holds that assignment, else Admin, and the Fundraiser is told.
 *
 * Assigning is only for a Campaign that names none: an Active Campaign's
 * Collecting Entity is the counterparty of every Donation it has taken, so
 * it is never swapped here.
 */
export async function assignCollectingEntity(
  prisma: PrismaClient,
  params: {
    campaignId: string;
    actor: LifecycleActor;
    collectingEntityId: unknown;
    reason: unknown;
    now?: Date;
  }
): Promise<LifecycleResult> {
  const requested = params.collectingEntityId;
  if (typeof requested !== "string" || requested.trim() === "") {
    throw new LifecycleValidationError("Collecting Entity wajib dipilih.", "collectingEntityId");
  }
  return runCommand(prisma, params, {
    authority: {
      capacity: "VERIFIER_OR_ADMIN",
      message: "Hanya Admin atau Verifier yang dapat menetapkan Collecting Entity.",
    },
    reasonPolicy: "required",
    rawReason: params.reason,
    allowedFrom: [CampaignStatus.ACTIVE],
    step: async ({ tx, campaign, actor, capacity, reason, now, notify }) => {
      if (campaign.collectingEntityId) throw new CollectingEntityAlreadySetError();
      const collectingEntityId = await resolveCollectingEntity(tx, campaign.creatorId, requested);
      await tx.campaign.update({ where: { id: campaign.id }, data: { collectingEntityId } });
      await tx.campaignStatusChange.create({
        data: {
          campaignId: campaign.id,
          action: CampaignStatusChangeAction.COLLECTING_ENTITY_ASSIGNED,
          fromStatus: null,
          toStatus: null,
          actorId: actor.userId,
          capacity,
          reason,
          createdAt: now,
        },
      });
      await notify({
        title: "Collecting Entity Ditetapkan",
        message: `Collecting Entity Campaign "${campaign.title}" telah ditetapkan. Campaign menerima donasi selama Partner Organisation itu memegang Fundraising Permit yang berlaku untuk Kind-nya. Alasan: ${reason}`,
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
