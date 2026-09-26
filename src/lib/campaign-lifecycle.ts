import {
  Assignment,
  CampaignStatus,
  CampaignStatusChangeAction,
  CancellationRequestStatus,
  FlagResolution,
  PayoutStatus,
  StatusChangeCapacity,
  VerificationOutcome,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";

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
  SameAdminLiftError,
  STATUS_LABEL,
} from "./campaign-lifecycle-errors";
import { judgeCapacity, requireAssignmentFor, type RequestedCapacity } from "./capacity";
import { effectiveStatus, lockAndLoad } from "./subject-guard";
import { SUBMITTABLE_STATUSES } from "./verification-submission";
import { getMailer, sendReportingFailure, type Mailer, type MailMessage } from "./mail";
import { verificationOutcomeEmail } from "./mail/verification-outcome";

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

export type VerificationRequestState = {
  id: string;
  campaignId: string;
  submittedById: string;
  submittedAt: Date;
  checklist: Prisma.JsonValue;
  outcome: VerificationOutcome;
  reason: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  isFirst: boolean;
};

export type SubmissionResult = LifecycleResult & { verificationRequest: VerificationRequestState };

/**
 * The Fundraiser submits their Draft or Rejected Campaign to a Verifier
 * (FFI-04, FFI-05). The Campaign becomes Submitted and a new PENDING
 * Verification Request opens, holding a snapshot of the checklist items
 * active right now, none ticked, so a later edit of the checklist never
 * changes what this request is judged against. A Draft's submission is the
 * Campaign's first request; a Rejected one's is a resubmission. Only its
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
      const items = await tx.verificationChecklistItem.findMany({
        where: { active: true },
        orderBy: { position: "asc" },
      });
      const checklist: ChecklistEntry[] = items.map((item) => ({
        id: item.id,
        label: item.label,
        required: item.required,
        position: item.position,
        ticked: false,
      }));
      const verificationRequest = await tx.verificationRequest.create({
        data: {
          campaignId: campaign.id,
          submittedById: actor.userId,
          submittedAt: now,
          checklist,
          isFirst: current === CampaignStatus.DRAFT,
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
 * The PENDING request `requestId` of this Campaign, read under its row lock.
 * The request is judged before the Campaign's status, so a missing, decided
 * or withdrawn request answers as such whatever the Campaign's status; a
 * pending one is only acted on while the Campaign is Submitted.
 */
async function readPendingRequest(tx: Tx, campaignId: string, requestId: string, current: CampaignStatus) {
  const request = await tx.verificationRequest.findUnique({ where: { id: requestId } });
  if (!request || request.campaignId !== campaignId) {
    throw new VerificationRequestNotFoundError(requestId);
  }
  if (request.outcome !== VerificationOutcome.PENDING) {
    throw new VerificationRequestNotPendingError(request.outcome);
  }
  if (current !== CampaignStatus.SUBMITTED) throw new InvalidTransitionError(current);
  return request;
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
 * rejection needs none. Recorded in the VERIFIER Capacity; a Verifier never
 * decides on a Campaign they own.
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
 * A failed send does not undo the decision; it is logged for an operator
 * (sendReportingFailure), and the in-app Notification, committed with the
 * decision, still tells the Fundraiser. The Mailer is resolved before
 * anything is read, so an unconfigured Mailer refuses the decision instead
 * of letting it pass in silence. `mailer` is for tests; routes use the
 * configured one.
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
  const mailer = params.mailer ?? getMailer();
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
      }
      const decided = {
        checklist,
        outcome: decision.outcome,
        reason,
        decidedById: actor.userId,
        decidedAt: now,
      };
      await closeRequest(tx, requestId, decided);
      await transition(decision.to, decision.action);
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
      await notify({ title: decision.title, message: decision.message(campaign.title, reason) });
      const fundraiser = await tx.user.findUniqueOrThrow({
        where: { id: campaign.creatorId },
        select: { email: true, name: true },
      });
      outcome.fundraiserId = campaign.creatorId;
      outcome.email = verificationOutcomeEmail({
        to: fundraiser.email,
        fundraiserName: fundraiser.name,
        campaignTitle: campaign.title,
        campaignUrl: `${siteUrl()}/campaign/${campaign.slug}`,
        ...(decision.outcome === VerificationOutcome.APPROVED
          ? { outcome: "approved" as const }
          : { outcome: "rejected" as const, reason: requireReason(reason) }),
      });
      return { verificationRequest: { ...request, ...decided }, identityVerificationRecorded };
    },
  });
  if (outcome.email && outcome.fundraiserId) {
    await sendReportingFailure(mailer, outcome.email, {
      mail: "verification_outcome",
      campaignId: params.campaignId,
      verificationRequestId: requestId,
      userId: outcome.fundraiserId,
    });
  }
  return result;
}

/**
 * The absolute site address links in an email start with. NEXTAUTH_URL is
 * the address the deployment actually answers on (docker-compose sets it).
 */
function siteUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "https://fundforindonesia.org";
  return base.replace(/\/+$/, "");
}

/** The Campaign and the request as a withdrawal leaves them; the same shape a submission returns. */
export type WithdrawalResult = SubmissionResult;

/**
 * The Fundraiser withdraws their undecided Verification Request (CONTEXT.md,
 * Verification Request). The request becomes WITHDRAWN, recording the
 * Fundraiser and `now` as who closed it and when, and the Campaign leaves
 * Submitted: back to Draft if this was its first request, back to Rejected
 * if it was a resubmission. Only its Fundraiser may withdraw, always in that
 * Capacity; nobody is notified, since the Fundraiser is the one acting.
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
      const withdrawn = {
        outcome: VerificationOutcome.WITHDRAWN,
        decidedById: actor.userId,
        decidedAt: now,
      };
      await closeRequest(tx, requestId, withdrawn);
      const to = request.isFirst ? CampaignStatus.DRAFT : CampaignStatus.REJECTED;
      await transition(to, CampaignStatusChangeAction.SUBMISSION_WITHDRAWN);
      // The spec's withdraw confirmation: the one lifecycle notice a
      // Fundraiser gets for their own action, so it bypasses `notify`.
      await tx.notification.create({
        data: {
          type: "campaign_status",
          userId: campaign.creatorId,
          link: `/campaign/${campaign.slug}`,
          title: "Pengajuan Ditarik",
          message: `Pengajuan Campaign "${campaign.title}" ke Verifier telah ditarik. Campaign kini ${STATUS_LABEL[to]} dan dapat diedit lalu diajukan kembali.`,
        },
      });
      return { verificationRequest: { ...request, ...withdrawn } };
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
