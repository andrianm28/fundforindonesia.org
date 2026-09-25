import {
  CampaignStatus,
  StatusChangeCapacity,
  VolunteerTripStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { CampaignLifecycleError, OwnCampaignConflictError } from "./campaign-lifecycle-errors";
import { MoneyError } from "./money/errors";
import type { LedgerSubject } from "./money/ledger";

/**
 * The subject guard: the one place that locks a Campaign or Volunteer Trip
 * row and reads it, for the lifecycle commands and for every money
 * operation that spends or freezes a subject's money (Payouts, Refunds, the
 * Escrow release). It is the only code in `src` that issues
 * `SELECT ... FOR UPDATE` on those two tables;
 * src/__tests__/properties/subject-lock-single-owner.test.ts pins that.
 *
 * LOCK ORDER. Where a transaction locks both a subject and a Payment, it
 * locks the subject first, through `lockAndLoad`, then the Payment. The
 * settlement webhook is the one path that touches Payment before Campaign,
 * and it only ever writes a Payment while it is still PENDING, which no
 * caller of this guard locks; see releaseMaturedEscrow (./money/escrow.ts).
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
      select: { creatorId: true, isDemo: true, lifecycleStatus: true, deadline: true },
    });
    if (!campaign) return null;
    return {
      kind: "campaign",
      id,
      ownerId: campaign.creatorId,
      isDemo: campaign.isDemo,
      effectiveStatus: effectiveStatus(campaign, now),
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

/** The Campaign effective statuses a Payout may be requested or approved in. */
const PAYOUT_ALLOWED_FROM: readonly CampaignStatus[] = [
  CampaignStatus.ACTIVE,
  CampaignStatus.EXPIRED,
  CampaignStatus.COMPLETED,
];

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
 * The Trip-side mirror of OwnCampaignConflictError: an Admin tried to act as
 * Admin on a Volunteer Trip they run as its Fundraiser. A typed refusal
 * like the lifecycle one (stable `code`, Indonesian `message`, 403 through
 * `domainErrorToHttp`), worded for a Trip.
 */
export class OwnTripConflictError extends MoneyError {
  readonly code = "OWN_TRIP_CONFLICT";
  constructor() {
    super(
      "Anda tidak dapat bertindak sebagai Admin atas Volunteer Trip milik Anda sendiri. Tindakan ini harus dilakukan Admin lain."
    );
    this.name = "OwnTripConflictError";
  }
}

/**
 * An Admin never acts as Admin on a Campaign or Volunteer Trip they own:
 * there they are only its Fundraiser (CONTEXT.md, Admin; ADR 0005).
 */
export function requireNotOwnerAsAdmin(state: SubjectState, actorId: string): void {
  if (state.ownerId !== actorId) return;
  if (state.kind === "campaign") {
    throw new OwnCampaignConflictError(StatusChangeCapacity.ADMIN);
  }
  throw new OwnTripConflictError();
}
