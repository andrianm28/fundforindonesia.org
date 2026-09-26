import {
  StatusChangeCapacity,
  VolunteerTripStatus,
  VolunteerTripStatusChangeAction,
  type Assignment,
  type Prisma,
  type PrismaClient,
  type VolunteerTrip,
} from '@/generated/prisma/client';
import { judgeCapacity, requireAssignmentFor } from '@/lib/capacity';
import { lockAndLoad, type SubjectState } from '@/lib/subject-guard';
import {
  TripNotEditableError,
  TripNotFoundError,
  TripNotSubmittedError,
} from '@/lib/volunteer-trip-errors';

/**
 * The Volunteer Trip operations module: the one place a Volunteer Trip's
 * status changes. Kept apart from the Campaign lifecycle (ADR 0014) and
 * deliberately not built on its command runner, but held to the same
 * discipline:
 *   - lock, then read: the Trip row is locked through the subject guard's
 *     `lockAndLoad` before anything reads it, so the status judged stays
 *     true until the transaction commits;
 *   - authority from the Capacity judgement (./../capacity.ts), asked with
 *     the Trip read under that lock;
 *   - predicated status writes, and typed refusals from the Trip error
 *     family (../volunteer-trip-errors.ts) that routes answer through
 *     `domainErrorToHttp`;
 *   - every status change recorded in VolunteerTripStatusChange, in the
 *     same transaction, with actor, Capacity, reason and time.
 *
 * LOCK ORDER, for every Trip operation: the Trip (through `lockAndLoad`),
 * then its Batch, then the Registration, then the Payment. Nothing here
 * locks in any other order.
 */

/** Who is acting, and the assignments they hold (ADR 0005). */
export type TripActor = { userId: string; assignments: readonly Assignment[] };

/** The Trip as the operation leaves it. */
export type TripResult = { trip: VolunteerTrip };

/** The fields a Fundraiser may change while their Trip is still editable. */
export type TripEdits = Partial<
  Pick<
    VolunteerTrip,
    'title' | 'description' | 'story' | 'coverImage' | 'destination' | 'itinerary' | 'tripFeeAmount'
  >
>;

/** The statuses a Fundraiser may edit and submit their Trip from. */
export const TRIP_EDITABLE_STATUSES: readonly VolunteerTripStatus[] = [
  VolunteerTripStatus.DRAFT,
  VolunteerTripStatus.REJECTED,
];

type Tx = Prisma.TransactionClient;
type LockedTrip = Extract<SubjectState, { kind: 'trip' }>;

async function lockTrip(tx: Tx, tripId: string, now: Date): Promise<LockedTrip> {
  const subject = await lockAndLoad(tx, { type: 'trip', tripId }, now);
  if (!subject || subject.kind !== 'trip') throw new TripNotFoundError(tripId);
  return subject;
}

/**
 * The one status write: predicated on the status judged under the lock (so
 * it always matches while the lock is held; a miss means a writer that
 * skipped the lock, and is refused rather than overwritten), carrying any
 * field edits in the same statement, then logged at `now`.
 */
async function transition(
  tx: Tx,
  trip: LockedTrip,
  change: {
    to: VolunteerTripStatus;
    action: VolunteerTripStatusChangeAction;
    actorId: string;
    capacity: StatusChangeCapacity;
    edits?: TripEdits;
    onMiss: () => Error;
  },
  now: Date,
): Promise<VolunteerTrip> {
  const from = trip.effectiveStatus;
  const written = await tx.volunteerTrip.updateMany({
    where: { id: trip.id, status: from },
    data: { ...change.edits, status: change.to },
  });
  if (written.count === 0) throw change.onMiss();
  await tx.volunteerTripStatusChange.create({
    data: {
      tripId: trip.id,
      action: change.action,
      fromStatus: from,
      toStatus: change.to,
      actorId: change.actorId,
      capacity: change.capacity,
      reason: null,
      createdAt: now,
    },
  });
  return tx.volunteerTrip.findUniqueOrThrow({ where: { id: trip.id } });
}

/**
 * The Trip's Fundraiser submits it for a Verifier's review, from Draft or
 * Rejected only; any `edits` sent with the submit are written in the same
 * statement. Only the owner may, whatever assignments anyone else holds
 * (FUNDRAISER Capacity). Refusals: TripNotFoundError (404),
 * NotAuthorizedError (403), TripNotEditableError (409), the last also for a
 * submit or decision committed before this call got the lock.
 */
export async function submitTrip(
  prisma: PrismaClient,
  params: { tripId: string; actor: TripActor; edits?: TripEdits; now?: Date },
): Promise<TripResult> {
  const { tripId, actor, edits, now = new Date() } = params;
  return prisma.$transaction(async (tx: Tx) => {
    const trip = await lockTrip(tx, tripId, now);
    const capacity = judgeCapacity(trip, actor, StatusChangeCapacity.FUNDRAISER);
    const current = trip.effectiveStatus;
    if (!TRIP_EDITABLE_STATUSES.includes(current)) throw new TripNotEditableError(current);
    const updated = await transition(
      tx,
      trip,
      {
        to: VolunteerTripStatus.SUBMITTED,
        action: VolunteerTripStatusChangeAction.SUBMITTED,
        actorId: actor.userId,
        capacity,
        edits,
        onMiss: () => new TripNotEditableError(current),
      },
      now,
    );
    return { trip: updated };
  });
}

const SUBMISSION_DECISIONS = {
  approve: {
    to: VolunteerTripStatus.ACTIVE,
    action: VolunteerTripStatusChangeAction.SUBMISSION_APPROVED,
    title: 'Volunteer Trip Disetujui',
    message: 'Volunteer Trip Anda telah disetujui dan kini aktif',
  },
  reject: {
    to: VolunteerTripStatus.REJECTED,
    action: VolunteerTripStatusChangeAction.SUBMISSION_REJECTED,
    title: 'Volunteer Trip Ditolak',
    message: 'Volunteer Trip Anda ditolak',
  },
} as const;

export type TripSubmissionDecision = keyof typeof SUBMISSION_DECISIONS;

export function isTripSubmissionDecision(value: unknown): value is TripSubmissionDecision {
  return typeof value === 'string' && Object.hasOwn(SUBMISSION_DECISIONS, value);
}

const VERIFIER_ONLY = 'Hanya Verifier yang dapat menyetujui atau menolak Volunteer Trip.';

/**
 * A Verifier approves (ACTIVE) or rejects (REJECTED) a Submitted Trip, and
 * the Fundraiser is told, in the same transaction. Recorded in the VERIFIER
 * Capacity, without a reason, as a Campaign decision is. Refusals:
 * NotAuthorizedError (403) without the VERIFIER assignment, before anything
 * is locked; TripNotFoundError (404); OwnSubjectConflictError (403,
 * OWN_TRIP_CONFLICT) for a Verifier who owns the Trip; TripNotSubmittedError
 * (409) from any other status, including a decision committed before this
 * call got the lock.
 */
export async function decideTripSubmission(
  prisma: PrismaClient,
  params: { tripId: string; actor: TripActor; decision: TripSubmissionDecision; now?: Date },
): Promise<TripResult> {
  const { tripId, actor, now = new Date() } = params;
  const decision = SUBMISSION_DECISIONS[params.decision];
  requireAssignmentFor(actor, StatusChangeCapacity.VERIFIER, VERIFIER_ONLY);
  return prisma.$transaction(async (tx: Tx) => {
    const trip = await lockTrip(tx, tripId, now);
    const capacity = judgeCapacity(trip, actor, StatusChangeCapacity.VERIFIER, VERIFIER_ONLY);
    if (trip.effectiveStatus !== VolunteerTripStatus.SUBMITTED) throw new TripNotSubmittedError();
    const updated = await transition(
      tx,
      trip,
      {
        to: decision.to,
        action: decision.action,
        actorId: actor.userId,
        capacity,
        onMiss: () => new TripNotSubmittedError(),
      },
      now,
    );
    await tx.notification.create({
      data: {
        type: 'volunteer_trip_moderation',
        title: decision.title,
        message: decision.message,
        userId: updated.fundraiserId,
        link: `/volunteer-trip/${updated.slug}`,
      },
    });
    return { trip: updated };
  });
}
