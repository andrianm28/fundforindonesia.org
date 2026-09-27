import {
  Assignment,
  CampaignStatus,
  StatusChangeCapacity,
  VolunteerTripStatus,
  type Kind,
  type Prisma,
} from "@/generated/prisma/client";
import {
  CampaignLifecycleError,
  CollectingEntityNotEditableError,
  DeadlineRequiredError,
  STATUS_LABEL,
} from "./campaign-lifecycle-errors";
import { missingRequiredDeadline } from "./campaign-kind";
import { judgeCapacity } from "./capacity";
import { PAYOUT_REQUESTABLE_STATUSES } from "./payout-requestable-statuses";
import type { LedgerSubject } from "./money/ledger";

/**
 * The subject guard: the one place that locks a Campaign or Volunteer Trip
 * row and reads it, for the lifecycle commands, for every money
 * operation that spends or freezes a subject's money (Payouts, Refunds, the
 * Escrow release), and for the Campaign content edit. It is the only code in `src` that issues
 * `SELECT ... FOR UPDATE` on those two tables;
 * src/__tests__/properties/subject-lock-single-owner.test.ts pins that.
 *
 * LOCK ORDER. Where a transaction locks both a subject and a Payment, it
 * locks the subject first, through `lockAndLoad`, then the Payment. The
 * settlement webhook is the one path that touches Payment before Campaign,
 * and it only ever writes a Payment while it is still PENDING, which no
 * caller of this guard locks; see releaseMaturedEscrow (./money/escrow.ts).
 * Volunteer Trip operations place a Batch and its Registrations between the
 * Trip and the Payment; that full order lives in ./volunteer/trip.ts.
 *
 * It also owns which Campaigns public listings show
 * (`listableCampaignWhere`, `sitemapCampaignWhere`), next to
 * `effectiveStatus`, so the lists and the Campaign page cannot disagree, and
 * so no listing can show a Demo Campaign (CONTEXT.md, Demo Campaign) that
 * another listing hides.
 *
 * Checks that need nothing from the subject (an assignment, a reason, the
 * Payout or Refund row's own status) may run before `lockAndLoad`. Nothing
 * reads the subject row before it: a read taken before the lock can be
 * stale by the time the transaction writes.
 */

/** What a caller learns about the subject, read under its row lock. */
export type SubjectState =
  | {
      kind: "campaign";
      id: string;
      /** The Campaign's Fundraiser (`creatorId`). */
      ownerId: string;
      isDemo: boolean;
      effectiveStatus: CampaignStatus;
      /** The Campaign's Kind (CONTEXT.md, Kind), named apart from the `kind` discriminant. */
      campaignKind: Kind;
      deadline: Date | null;
      /** The Partner Organisation it collects under (ADR 0010), or null. */
      collectingEntityId: string | null;
    }
  | {
      kind: "trip";
      id: string;
      /** The Trip's Fundraiser. */
      ownerId: string;
      /** A Volunteer Trip has no demo concept. */
      isDemo: false;
      /** A Trip has no lazy expiry: its own stored status. */
      effectiveStatus: VolunteerTripStatus;
    };

/**
 * Just a subject's kind and effective status: what a status rule needs,
 * without the rest of what `lockAndLoad` reads. Kept per kind so the
 * discriminant still narrows the status.
 */
export type SubjectStatus =
  | Pick<Extract<SubjectState, { kind: "campaign" }>, "kind" | "effectiveStatus">
  | Pick<Extract<SubjectState, { kind: "trip" }>, "kind" | "effectiveStatus">;

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

/**
 * The clause that keeps a Demo Campaign (CONTEXT.md, Demo Campaign) out of a
 * list a visitor reads. Its data is fiction -- the `collectedAmount` on its
 * row came from a seed file, not from a settled Payment -- so listing it
 * would put invented numbers in front of someone deciding whether to give.
 *
 * It reads the column, never a list of Campaigns: which rows are fiction is
 * a fact about the data, and the Campaigns an earlier migration happened to
 * mark are not something a query should carry (prd-compliance 26). A
 * Campaign's title, slug or id says nothing, so a newly seeded fiction is
 * hidden by being flagged, not by being recognised.
 *
 * Exported because a public feed that reaches a Campaign through another
 * record needs the same clause: a Prayer names the Campaign it was left on
 * and links to it, so the platform-wide Prayer feed excludes them the same
 * way (src/app/api/prayers/route.ts, src/app/page.tsx).
 */
export const NOT_A_DEMO_CAMPAIGN: Prisma.CampaignWhereInput = { isDemo: false };

/**
 * The Campaigns a public list shows (CONTEXT.md, Campaign Status; Demo
 * Campaign): exactly those `effectiveStatus` calls ACTIVE, i.e. stored ACTIVE
 * with no deadline or one not yet passed, and no Demo Campaign among them.
 *
 * The rule sits inside an AND so callers can spread it next to their own
 * filters, an OR of their own included, without overwriting it. Readers
 * only filter; lazy expiry is for commands.
 *
 * `includeDemo` is for a privileged screen that must still see them -- an
 * Admin working on a Campaign the public cannot see. It is opt-in, so a
 * listing cannot end up showing fiction by forgetting an argument.
 */
export function listableCampaignWhere(
  now: Date,
  options: { includeDemo?: boolean } = {}
): Prisma.CampaignWhereInput {
  return {
    AND: [
      ...(options.includeDemo ? [] : [NOT_A_DEMO_CAMPAIGN]),
      {
        lifecycleStatus: CampaignStatus.ACTIVE,
        OR: [{ deadline: null }, { deadline: { gte: now } }],
      },
    ],
  };
}

/** The effective statuses whose Campaign pages the sitemap lists. */
const SITEMAP_STATUSES: readonly CampaignStatus[] = [
  CampaignStatus.ACTIVE,
  CampaignStatus.EXPIRED,
  CampaignStatus.COMPLETED,
];

/**
 * The Campaigns the sitemap lists: effectively Active, Expired or Completed,
 * so an ended Campaign's transparency page stays findable. Suspended,
 * Cancelled, Submitted, Rejected and Draft are never listed.
 *
 * A stored ACTIVE Campaign is effectively ACTIVE or EXPIRED whatever its
 * deadline, and both are listed, so the rule needs no `now`. A Demo Campaign
 * is never listed: the sitemap exists to have a search engine send visitors
 * to it, and there is nothing true to send them to (CONTEXT.md, Demo
 * Campaign; prd-compliance 26).
 */
export function sitemapCampaignWhere(): Prisma.CampaignWhereInput {
  return { ...NOT_A_DEMO_CAMPAIGN, lifecycleStatus: { in: [...SITEMAP_STATUSES] } };
}

/**
 * Takes the row lock on the subject, then reads it, in the caller's
 * transaction. The lock is held until that transaction ends, so the state
 * returned, and every other read the caller makes of this subject's money
 * afterwards, stays true until it commits. Returns null when no such row
 * exists; what that means is the caller's to decide.
 */
export async function lockAndLoad(
  tx: Prisma.TransactionClient,
  subject: LedgerSubject,
  now: Date
): Promise<SubjectState | null> {
  if (subject.type === "campaign") {
    const id = subject.campaignId;
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${id} FOR UPDATE`;
    const campaign = await tx.campaign.findUnique({
      where: { id },
      select: {
        creatorId: true,
        isDemo: true,
        lifecycleStatus: true,
        deadline: true,
        kind: true,
        collectingEntityId: true,
      },
    });
    if (!campaign) return null;
    return {
      kind: "campaign",
      id,
      ownerId: campaign.creatorId,
      isDemo: campaign.isDemo,
      effectiveStatus: effectiveStatus(campaign, now),
      campaignKind: campaign.kind,
      deadline: campaign.deadline,
      collectingEntityId: campaign.collectingEntityId,
    };
  }
  const id = subject.tripId;
  await tx.$queryRaw`SELECT id FROM "VolunteerTrip" WHERE id = ${id} FOR UPDATE`;
  const trip = await tx.volunteerTrip.findUnique({
    where: { id },
    select: { fundraiserId: true, status: true },
  });
  if (!trip) return null;
  return {
    kind: "trip",
    id,
    ownerId: trip.fundraiserId,
    isDemo: false,
    effectiveStatus: trip.status,
  };
}

/**
 * The Campaign effective statuses a Payout may be requested or approved in.
 *
 * The list itself lives in ./payout-requestable-statuses.ts, which imports no
 * Prisma values so a browser bundle can ask the same question this guard
 * answers. Written against it here rather than kept as a second copy, so a
 * status a screen offers and a status the money layer accepts cannot drift
 * apart.
 */
const PAYOUT_ALLOWED_FROM: readonly CampaignStatus[] = PAYOUT_REQUESTABLE_STATUSES;

/** A Payout refused because of the Campaign's status (CONTEXT.md, Payout). */
export class PayoutNotAllowedForStatusError extends CampaignLifecycleError {
  readonly code = "PAYOUT_NOT_ALLOWED_FOR_STATUS";
  constructor(readonly currentStatus: CampaignStatus) {
    super(
      "Payout tidak dapat diajukan atau disetujui karena status Campaign tidak mengizinkannya."
    );
    this.name = "PayoutNotAllowedForStatusError";
  }
}

/**
 * Passes only for a Campaign that is effectively Active, Expired or
 * Completed (keep-it-all, ADR 0004); Suspended and Cancelled refuse. A
 * Volunteer Trip keeps its rule of today, which has no status check.
 */
export function requirePayoutAllowed(state: SubjectState): void {
  if (state.kind === "trip") return;
  if (!PAYOUT_ALLOWED_FROM.includes(state.effectiveStatus)) {
    throw new PayoutNotAllowedForStatusError(state.effectiveStatus);
  }
}

/**
 * The Campaign effective statuses whose content (title, description, story,
 * cover image; verification-request ticket 05) its Fundraiser or an Admin
 * may edit directly. Submitted is frozen so the Verifier checks a fixed
 * version (CONTEXT.md, Verification Request); the final statuses are closed.
 */
const CONTENT_EDITABLE_STATUSES: readonly CampaignStatus[] = [
  CampaignStatus.DRAFT,
  CampaignStatus.REJECTED,
  CampaignStatus.ACTIVE,
];

/** A content edit refused because of the Campaign's effective status. */
export class CampaignNotEditableError extends CampaignLifecycleError {
  readonly code = "CAMPAIGN_NOT_EDITABLE";
  constructor(readonly currentStatus: CampaignStatus) {
    super(`Konten Campaign tidak dapat diubah saat berstatus ${STATUS_LABEL[currentStatus]}.`);
    this.name = "CampaignNotEditableError";
  }
}

/**
 * Passes only for a Campaign that is effectively Draft, Rejected or Active,
 * so an Active Campaign past its deadline refuses as Expired. Judge it on
 * `lockAndLoad`'s result, so a submit that committed first is seen. A
 * Volunteer Trip has its own edit rule (TRIP_EDITABLE_STATUSES) and is not
 * judged here.
 */
export function requireContentEditable(state: SubjectState): void {
  if (state.kind !== "campaign") return;
  if (!CONTENT_EDITABLE_STATUSES.includes(state.effectiveStatus)) {
    throw new CampaignNotEditableError(state.effectiveStatus);
  }
}

/**
 * A title or description edit refused because the Campaign is effectively
 * Active (verification-request ticket 09). Stricter than PRD FFI-05, on
 * purpose (CONTEXT.md, Verification Request; PRD §13): a Donor should never
 * give to one purpose and later find its title or description changed.
 * Story and cover image stay editable, and this never fires outside Active
 * (`requireContentEditable` already refuses every other closed status).
 */
export class ActiveContentFrozenError extends CampaignLifecycleError {
  readonly code = "ACTIVE_CONTENT_FROZEN";
  constructor() {
    super("Judul dan deskripsi Campaign tidak dapat diubah lagi saat berstatus Aktif.");
    this.name = "ActiveContentFrozenError";
  }
}

/**
 * Passes for every content edit except a title or description edit on an
 * effectively Active Campaign. Judge it right after `requireContentEditable`,
 * on the same `lockAndLoad` result, so a submit or a status change committed
 * first is seen here too. `edit` is the parsed request body (or the fields
 * about to be written): only whether title or description is present
 * matters, not their values, so naming the value already stored still
 * refuses -- unlike Kind, deadline and Collecting Entity, whose edits pass
 * when they leave the field unchanged.
 */
export function requireActiveContentFieldsEditable(
  state: SubjectState,
  edit: { title?: unknown; description?: unknown; [key: string]: unknown }
): void {
  if (state.kind !== "campaign") return;
  if (state.effectiveStatus !== CampaignStatus.ACTIVE) return;
  if (edit.title !== undefined || edit.description !== undefined) {
    throw new ActiveContentFrozenError();
  }
}

/** A change of Kind refused because the Campaign has left Draft. */
export class KindImmutableError extends CampaignLifecycleError {
  readonly code = "KIND_IMMUTABLE";
  constructor(readonly currentStatus: CampaignStatus) {
    super("Kind Campaign tidak dapat diubah setelah Campaign meninggalkan Draft.");
    this.name = "KindImmutableError";
  }
}

/** A deadline change refused because the Campaign is past Draft and Rejected. */
export class DeadlineNotEditableError extends CampaignLifecycleError {
  readonly code = "DEADLINE_NOT_EDITABLE";
  constructor(readonly currentStatus: CampaignStatus) {
    super("Tenggat Campaign hanya dapat diubah saat berstatus Draft atau Rejected.");
    this.name = "DeadlineNotEditableError";
  }
}

/** The effective statuses a direct edit may change the deadline in. */
const DEADLINE_EDITABLE_STATUSES: readonly CampaignStatus[] = [
  CampaignStatus.DRAFT,
  CampaignStatus.REJECTED,
];

/**
 * Judges an edit of a Campaign's Kind or deadline (prd-compliance 09), the
 * two fields its deadline rule reads. Naming the value a field already has
 * is no change and always passes.
 * - Kind changes only while effectively Draft: once submitted the Verifier
 *   and then Donors rely on it, and a Rejected Campaign was judged as it.
 * - The deadline changes only while Draft or Rejected, before a Verifier
 *   approves it; an Active one's moves through a new Verification Request
 *   (CONTEXT.md, Verification Request).
 * - What the edit leaves must still give the Kind the deadline it needs.
 * Judge it on `lockAndLoad`'s result, like `requireContentEditable`.
 */
export function requireKindAndDeadlineEditable(
  state: SubjectState,
  edit: { kind?: Kind; deadline?: Date | null }
): void {
  if (state.kind !== "campaign") return;
  const kindChanges = edit.kind !== undefined && edit.kind !== state.campaignKind;
  const deadlineChanges =
    edit.deadline !== undefined && edit.deadline?.getTime() !== state.deadline?.getTime();
  if (kindChanges && state.effectiveStatus !== CampaignStatus.DRAFT) {
    throw new KindImmutableError(state.effectiveStatus);
  }
  if (deadlineChanges && !DEADLINE_EDITABLE_STATUSES.includes(state.effectiveStatus)) {
    throw new DeadlineNotEditableError(state.effectiveStatus);
  }
  if (!kindChanges && !deadlineChanges) return;
  const after = {
    kind: edit.kind ?? state.campaignKind,
    deadline: edit.deadline !== undefined ? edit.deadline : state.deadline,
  };
  if (missingRequiredDeadline(after)) throw new DeadlineRequiredError(after.kind);
}

/**
 * Judges an edit of a Campaign's Collecting Entity (prd-compliance 10): it
 * changes only while effectively Draft or Rejected, like the deadline,
 * before a Verifier confirms it by approving; once Active it is the
 * counterparty of the Donations taken, and only an Admin or Verifier may
 * name one for an Active Campaign that has none (assignCollectingEntity).
 * Naming the one it already has is no change and always passes. Whether the
 * organisation named is one this Fundraiser may collect under is judged
 * apart (./collecting-entity-guard.ts). Judge it on `lockAndLoad`'s result.
 */
/** The effective statuses a direct edit may change the Collecting Entity in: before a Verifier confirms it. */
const COLLECTING_ENTITY_EDITABLE_STATUSES: readonly CampaignStatus[] = [
  CampaignStatus.DRAFT,
  CampaignStatus.REJECTED,
];

export function requireCollectingEntityEditable(
  state: SubjectState,
  edit: { collectingEntityId?: string | null }
): void {
  if (state.kind !== "campaign") return;
  if (edit.collectingEntityId === undefined || edit.collectingEntityId === state.collectingEntityId) return;
  if (!COLLECTING_ENTITY_EDITABLE_STATUSES.includes(state.effectiveStatus)) {
    throw new CollectingEntityNotEditableError(state.effectiveStatus);
  }
}

/**
 * Whether the Escrow release must leave this subject's matured money in
 * Escrow Hold: true only for a Campaign that is effectively Suspended
 * (CONTEXT.md, Escrow Hold; Suspension). The release resumes on its own once
 * the Suspension is lifted. A Volunteer Trip keeps its rule of today (ADR
 * 0014), which never holds matured money back.
 *
 * It needs only the subject's kind and effective status, so a read-only
 * report can ask the same question without taking the row lock; the Escrow
 * release asks it of `lockAndLoad`'s result.
 */
export function isEscrowReleaseFrozen(subject: SubjectStatus): boolean {
  return subject.kind === "campaign" && subject.effectiveStatus === CampaignStatus.SUSPENDED;
}

/**
 * An Admin never acts as Admin on a Campaign or Volunteer Trip they own:
 * there they are only its Fundraiser (CONTEXT.md, Capacity; ADR 0005).
 * Refuses with OwnSubjectConflictError (./capacity.ts).
 *
 * For the money operations, which take only the acting person's id: their
 * routes have already required the ADMIN assignment (withAssignmentCheck),
 * so the actor is judged as holding it and only ownership is left to decide.
 */
export function requireNotOwnerAsAdmin(state: SubjectState, actorId: string): void {
  judgeCapacity(
    state,
    { userId: actorId, assignments: [Assignment.ADMIN] },
    StatusChangeCapacity.ADMIN
  );
}
