import {
  RegistrationStatus,
  StatusChangeCapacity,
  VolunteerBatchStatus,
  VolunteerTripStatus,
  VolunteerTripStatusChangeAction,
  type Assignment,
  type Payment,
  type Prisma,
  type PrismaClient,
  type VolunteerBatch,
  type VolunteerTrip,
} from '@/generated/prisma/client';
import { fundraiserOnlyRefusal, judgeCapacity, requireAssignmentFor } from '@/lib/capacity';
import { createRefund } from '@/lib/money/refunds';
import { lockAndLoad, type SubjectState } from '@/lib/subject-guard';
import {
  BatchFieldsInvalidError,
  BatchMinQuotaMetError,
  BatchNotEndedError,
  BatchNotFoundError,
  BatchNotOpenError,
  TripNotAcceptingBatchesError,
  TripNotEditableError,
  TripNotFoundError,
  TripNotSubmittedError,
} from '@/lib/volunteer-trip-errors';

/**
 * The Volunteer Trip operations module: the one place a Volunteer Trip's
 * or Volunteer Batch's status changes. Kept apart from the Campaign
 * lifecycle (ADR 0014) and deliberately not built on its command runner,
 * but held to the same discipline:
 *   - lock, then read: the Trip row is locked through the subject guard's
 *     `lockAndLoad` before anything reads it, and a Batch or Registration
 *     row likewise, so the status judged stays true until the transaction
 *     commits;
 *   - authority from the Capacity judgement (./../capacity.ts), asked with
 *     the Trip read under that lock;
 *   - predicated status writes, and typed refusals from the Trip error
 *     family (../volunteer-trip-errors.ts) that routes answer through
 *     `domainErrorToHttp`;
 *   - every Trip status change recorded in VolunteerTripStatusChange, in
 *     the same transaction, with actor, Capacity, reason and time. Batch
 *     and Registration changes are not logged there: their money trail is
 *     the ledger and Refunds.
 *
 * LOCK ORDER, for every Trip operation, and documented only here:
 *   1. the Trip, through the subject guard's `lockAndLoad`;
 *   2. its Batch (`lockOpenBatch`);
 *   3. the Batch's Registrations, in id order (`lockLiveRegistrations`);
 *   4. each Payment, inside `createRefund`, which first re-enters the Trip
 *      lock this transaction already holds and so waits on nothing.
 * An operation may stop early, but never takes an earlier lock after a
 * later one. This is the subject guard's "subject before Payment" rule
 * with Batch and Registration placed between. The Batch and Registration
 * locks are taken nowhere else in `src` but the Registration hold route,
 * which locks only a Batch; src/__tests__/properties/subject-lock-single-
 * owner.test.ts pins who may. src/lib/volunteer/trip-batches.test.ts pins
 * the order through the in-memory stand-in's lock log.
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

/** A Volunteer Batch's Fundraiser-set dates and quotas (ADR 0014). */
export type BatchFields = {
  startDate: Date;
  endDate: Date;
  registrationDeadline: Date;
  maxQuota: number;
  minQuota: number;
};

/** The Batch as the operation leaves it. */
export type BatchResult = { batch: VolunteerBatch };

/**
 * A Trip in any status but Cancelled or Completed takes new Batches: a new
 * date on an approved Trip is a normal new intake, and a Fundraiser filling
 * in a Draft adds Batches before first submitting it.
 */
const BATCH_ADDABLE_STATUSES: readonly VolunteerTripStatus[] = [
  VolunteerTripStatus.DRAFT,
  VolunteerTripStatus.SUBMITTED,
  VolunteerTripStatus.REJECTED,
  VolunteerTripStatus.ACTIVE,
  VolunteerTripStatus.SUSPENDED,
];

/**
 * Batch operations are the Trip's Fundraiser's, or an Admin's: the owner
 * acts as FUNDRAISER even holding ADMIN, anyone else only as ADMIN.
 */
function judgeBatchAuthority(trip: LockedTrip, actor: TripActor): void {
  // The Capacity is not kept: Batch changes are not logged (see the header).
  judgeCapacity(trip, actor, 'FUNDRAISER_OR_ADMIN', fundraiserOnlyRefusal('trip'));
}

/** A Batch's dates and quotas must agree with each other. */
function requireConsistentBatch(fields: BatchFields): void {
  if (fields.minQuota > fields.maxQuota) {
    throw new BatchFieldsInvalidError('minQuota', 'minQuota tidak boleh melebihi maxQuota');
  }
  if (fields.endDate < fields.startDate) {
    throw new BatchFieldsInvalidError('endDate', 'endDate tidak boleh sebelum startDate');
  }
  if (fields.registrationDeadline > fields.startDate) {
    throw new BatchFieldsInvalidError('registrationDeadline', 'registrationDeadline tidak boleh setelah startDate');
  }
}

/**
 * The Trip's Fundraiser, or an Admin, adds an OPEN Batch to it. Refusals:
 * TripNotFoundError (404); NotAuthorizedError (403);
 * TripNotAcceptingBatchesError (400) for a Cancelled or Completed Trip;
 * BatchFieldsInvalidError (400).
 */
export async function createBatch(
  prisma: PrismaClient,
  params: { tripId: string; actor: TripActor; fields: BatchFields; now?: Date },
): Promise<BatchResult> {
  const { tripId, actor, fields, now = new Date() } = params;
  return prisma.$transaction(async (tx: Tx) => {
    const trip = await lockTrip(tx, tripId, now);
    judgeBatchAuthority(trip, actor);
    if (!BATCH_ADDABLE_STATUSES.includes(trip.effectiveStatus)) {
      throw new TripNotAcceptingBatchesError(trip.effectiveStatus);
    }
    requireConsistentBatch(fields);
    const batch = await tx.volunteerBatch.create({
      data: { tripId: trip.id, ...fields, status: VolunteerBatchStatus.OPEN },
    });
    return { batch };
  });
}

type BatchOperation = { tripId: string; batchId: string; actor: TripActor; now?: Date };

/**
 * The second lock in the order: the Batch row, taken after its Trip's and
 * read only once held. Only a Batch of this Trip counts, and only while
 * OPEN: no Batch operation acts on one that is closed, cancelled or done.
 */
async function lockOpenBatch(tx: Tx, trip: LockedTrip, batchId: string): Promise<VolunteerBatch> {
  // Scoped to the Trip in the lock itself, so an id from another Trip locks
  // nothing: no Batch is ever locked without its own Trip's lock held.
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "VolunteerBatch" WHERE id = ${batchId} AND "tripId" = ${trip.id} FOR UPDATE
  `;
  if (locked.length === 0) throw new BatchNotFoundError(batchId);
  const batch = await tx.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status !== VolunteerBatchStatus.OPEN) throw new BatchNotOpenError(batch.status);
  return batch;
}

/**
 * Write a Batch, predicated on it still being OPEN, as it was read under
 * the lock; a miss means a writer that skipped the lock, and is refused
 * rather than overwritten.
 */
async function writeOpenBatch(
  tx: Tx,
  batch: VolunteerBatch,
  data: Partial<BatchFields> & { status?: VolunteerBatchStatus },
): Promise<VolunteerBatch> {
  const written = await tx.volunteerBatch.updateMany({
    where: { id: batch.id, status: VolunteerBatchStatus.OPEN },
    data,
  });
  if (written.count === 0) throw new BatchNotOpenError(batch.status);
  return tx.volunteerBatch.findUniqueOrThrow({ where: { id: batch.id } });
}

/**
 * The Trip's Fundraiser, or an Admin, changes an OPEN Batch's dates or
 * quotas, judged together with what is stored. Refusals: TripNotFoundError
 * and BatchNotFoundError (404); NotAuthorizedError (403); BatchNotOpenError
 * (409); BatchFieldsInvalidError (400).
 */
export async function editBatch(
  prisma: PrismaClient,
  params: BatchOperation & { edits: Partial<BatchFields> },
): Promise<BatchResult> {
  const { tripId, batchId, actor, edits, now = new Date() } = params;
  return prisma.$transaction(async (tx: Tx) => {
    const trip = await lockTrip(tx, tripId, now);
    judgeBatchAuthority(trip, actor);
    const batch = await lockOpenBatch(tx, trip, batchId);
    const changed = Object.fromEntries(
      Object.entries(edits).filter(([, value]) => value !== undefined),
    ) as Partial<BatchFields>;
    requireConsistentBatch({ ...batch, ...changed });
    return { batch: await writeOpenBatch(tx, batch, changed) };
  });
}

/**
 * The Trip's Fundraiser, or an Admin, marks an OPEN Batch COMPLETED once
 * its endDate has passed. Refusals: TripNotFoundError and BatchNotFoundError
 * (404); NotAuthorizedError (403); BatchNotOpenError (409), also for a
 * cancel or complete committed before this call got the lock;
 * BatchNotEndedError (400).
 */
export async function completeBatch(prisma: PrismaClient, params: BatchOperation): Promise<BatchResult> {
  const { tripId, batchId, actor, now = new Date() } = params;
  return prisma.$transaction(async (tx: Tx) => {
    const trip = await lockTrip(tx, tripId, now);
    judgeBatchAuthority(trip, actor);
    const batch = await lockOpenBatch(tx, trip, batchId);
    if (batch.endDate > now) throw new BatchNotEndedError();
    return { batch: await writeOpenBatch(tx, batch, { status: VolunteerBatchStatus.COMPLETED }) };
  });
}

/** One paid Registration's Refund, as a Batch cancel created it. */
export type BatchCancelRefund = { registrationId: string; refundId: string; amount: number };

export type CancelBatchResult = BatchResult & { refunds: BatchCancelRefund[] };

/** The Trip Fee Refund cases this module decides so far. */
type TripFeeRefundCase = 'batch cancel';

/**
 * The Trip Fee Refund policy's amount and reason for a paid Registration.
 * Only the "batch cancel" case lives here yet: the full Trip Fee, whenever
 * it happens (CONTEXT.md, Trip Fee). The volunteer-cancel and
 * late-settlement cases join it with the Registration operations.
 */
function tripFeeRefund(
  payment: Pick<Payment, 'amount'>,
  refundCase: TripFeeRefundCase,
): { amount: number; reason: string } {
  switch (refundCase) {
    case 'batch cancel':
      return { amount: payment.amount, reason: 'Batch dibatalkan karena tidak mencapai kuota minimum' };
  }
}

/**
 * The third lock in the order: every live (HOLD or CONFIRMED) Registration
 * on the Batch, in id order, in one statement. A settlement that commits
 * before this lock is taken is seen here as CONFIRMED and refunded; one
 * that waits on it finds a cancelled Registration afterwards.
 */
async function lockLiveRegistrations(
  tx: Tx,
  batchId: string,
): Promise<Array<{ id: string; status: RegistrationStatus }>> {
  return tx.$queryRaw<Array<{ id: string; status: RegistrationStatus }>>`
    SELECT id, status FROM "Registration"
    WHERE "batchId" = ${batchId} AND status IN ('HOLD', 'CONFIRMED')
    ORDER BY id
    FOR UPDATE
  `;
}

/**
 * The Trip's Fundraiser, or an Admin, cancels an OPEN Batch that has not
 * reached its minimum quota of CONFIRMED Registrations. Every live
 * Registration on it is cancelled, so no one goes on paying into a Batch
 * that will not run; each CONFIRMED one gets the full Trip Fee back, as a
 * REQUESTED Refund frozen at once and requested by the actor. A HOLD
 * Registration has no settled Payment, so nothing to refund.
 *
 * Locks Trip → Batch → Registrations → each Payment (the last inside
 * `createRefund`, which re-enters the Trip lock already held).
 *
 * Refusals: TripNotFoundError and BatchNotFoundError (404);
 * NotAuthorizedError (403); BatchNotOpenError (409), also for a second
 * cancel, so no Registration is refunded twice; BatchMinQuotaMetError (400).
 */
export async function cancelBatch(prisma: PrismaClient, params: BatchOperation): Promise<CancelBatchResult> {
  const { tripId, batchId, actor, now = new Date() } = params;
  return prisma.$transaction(async (tx: Tx) => {
    const trip = await lockTrip(tx, tripId, now);
    judgeBatchAuthority(trip, actor);
    const batch = await lockOpenBatch(tx, trip, batchId);
    const live = await lockLiveRegistrations(tx, batch.id);
    const confirmedIds = live.filter((r) => r.status === RegistrationStatus.CONFIRMED).map((r) => r.id);
    if (confirmedIds.length >= batch.minQuota) throw new BatchMinQuotaMetError();

    const cancelled = await writeOpenBatch(tx, batch, { status: VolunteerBatchStatus.CANCELLED });
    const paid = await tx.registration.findMany({
      where: { id: { in: confirmedIds } },
      include: { payment: true },
    });
    await tx.registration.updateMany({
      where: { id: { in: live.map((r) => r.id) } },
      data: { status: RegistrationStatus.CANCELLED },
    });

    const refunds: BatchCancelRefund[] = [];
    for (const registration of paid) {
      // A CONFIRMED Registration always has a settled Payment (schema.prisma).
      const payment = registration.payment;
      if (!payment) throw new Error(`CONFIRMED Registration ${registration.id} has no Payment`);
      const { amount, reason } = tripFeeRefund(payment, 'batch cancel');
      const refund = await createRefund(tx, {
        subject: { type: 'trip', tripId: trip.id },
        paymentId: payment.id,
        amount,
        reason,
        requestedById: actor.userId,
      });
      refunds.push({ registrationId: registration.id, refundId: refund.id, amount: refund.amount });
    }
    return { batch: cancelled, refunds };
  });
}
