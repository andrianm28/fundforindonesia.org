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
  type Refund,
  type Registration,
  type VolunteerBatch,
  type VolunteerTrip,
} from '@/generated/prisma/client';
import { fundraiserOnlyRefusal, judgeCapacity, NotAuthorizedError, requireAssignmentFor } from '@/lib/capacity';
import { recordIdentityVerification } from '@/lib/identity-verification';
import { createRefund } from '@/lib/money/refunds';
import { lockAndLoad, type SubjectState } from '@/lib/subject-guard';
import {
  AlreadyRegisteredError,
  BatchAlreadyCompletedError,
  BatchFieldsInvalidError,
  BatchFullError,
  BatchMinQuotaMetError,
  BatchNotEndedError,
  BatchNotFoundError,
  BatchNotOpenError,
  BatchNotTakingRegistrationsError,
  RegistrationDeadlinePassedError,
  RegistrationNotCancellableError,
  RegistrationNotFoundError,
  TripNotAcceptingBatchesError,
  TripNotEditableError,
  TripNotFoundError,
  TripNotSubmittedError,
  TripNotTakingRegistrationsError,
  TripRejectionReasonInvalidError,
} from '@/lib/volunteer-trip-errors';
import { tripFeeRefund, type TripFeeRefundCase } from './refunds';

/**
 * The Volunteer Trip operations module: the one place a Volunteer Trip's,
 * Volunteer Batch's or Registration's status changes (the last pinned by
 * src/__tests__/properties/registration-status-single-writer.test.ts), and
 * the one caller of the Trip Fee Refund policy (./refunds.ts,
 * `tripFeeRefund`). Kept apart from the Campaign
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
 *   2. its Batch (`lockBatch`, `lockOpenBatch`);
 *   3. Registrations: a Batch's live ones in id order
 *      (`lockLiveRegistrations`), or one by id (`lockRegistration`);
 *   4. each Payment, inside `createRefund`, which first re-enters the Trip
 *      lock this transaction already holds and so waits on nothing.
 * An operation may stop early or skip a step, but never takes an earlier
 * lock after a later one. This is the subject guard's "subject before
 * Payment" rule with Batch and Registration placed between. The Batch and
 * Registration locks are taken nowhere else in `src`;
 * src/__tests__/properties/subject-lock-single-owner.test.ts pins that,
 * and trip-batches.test.ts and trip-registrations.test.ts pin the order
 * through the in-memory stand-in's lock log.
 *
 * The one exception is Settlement (`confirmRegistration`,
 * `expireRegistrationHold`): the webhook writes the Payment first, in its
 * own transaction, and the Registration after it without a lock. Why that
 * cannot deadlock is on `confirmRegistration`.
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
    reason?: string | null;
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
      reason: change.reason ?? null,
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

/** The longest rejection reason, the same bound as a Bank Account rejection's. */
const MAX_REJECTION_REASON_LENGTH = 1000;

/** A rejection's required reason: trimmed, non-blank, within the bound. */
function cleanRejectionReason(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') throw new TripRejectionReasonInvalidError('Alasan penolakan wajib diisi.');
  if (text.length > MAX_REJECTION_REASON_LENGTH) {
    throw new TripRejectionReasonInvalidError(`Alasan penolakan maksimal ${MAX_REJECTION_REASON_LENGTH} karakter.`);
  }
  return text;
}

const VERIFIER_ONLY = 'Hanya Verifier yang dapat menyetujui atau menolak Volunteer Trip.';

/**
 * A Verifier approves (ACTIVE) or rejects (REJECTED) a Submitted Trip, and
 * the Fundraiser is told, in the same transaction. Recorded in the VERIFIER
 * Capacity; a rejection requires a reason (`TripRejectionReasonInvalidError`, 422,
 * before anything is locked) and logs it, an approval logs none. Refusals:
 * NotAuthorizedError (403) without the VERIFIER assignment, before anything
 * is locked; TripNotFoundError (404); OwnSubjectConflictError (403,
 * OWN_TRIP_CONFLICT) for a Verifier who owns the Trip; TripNotSubmittedError
 * (409) from any other status, including a decision committed before this
 * call got the lock.
 */
export async function decideTripSubmission(
  prisma: PrismaClient,
  params: { tripId: string; actor: TripActor; decision: TripSubmissionDecision; reason?: unknown; now?: Date },
): Promise<TripResult> {
  const { tripId, actor, now = new Date() } = params;
  const decision = SUBMISSION_DECISIONS[params.decision];
  requireAssignmentFor(actor, StatusChangeCapacity.VERIFIER, VERIFIER_ONLY);
  // A rejection carries its reason; an approval stores none, whatever was sent.
  const reason = params.decision === 'reject' ? cleanRejectionReason(params.reason) : null;
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
        reason,
        onMiss: () => new TripNotSubmittedError(),
      },
      now,
    );
    if (decision.to === VolunteerTripStatus.ACTIVE) {
      // The Fundraiser's identity is checked once, on their first approved
      // submission of either kind (CONTEXT.md, Fundraiser).
      await recordIdentityVerification(tx, {
        userId: updated.fundraiserId,
        verifierId: actor.userId,
        verifiedAt: now,
      });
    }
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
  const batch = await lockBatch(tx, trip, batchId);
  if (batch.status !== VolunteerBatchStatus.OPEN) throw new BatchNotOpenError(batch.status);
  return batch;
}

/** The second lock in the order, whatever the Batch's status. */
async function lockBatch(tx: Tx, trip: LockedTrip, batchId: string): Promise<VolunteerBatch> {
  // Scoped to the Trip in the lock itself, so an id from another Trip locks
  // nothing: no Batch is ever locked without its own Trip's lock held.
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "VolunteerBatch" WHERE id = ${batchId} AND "tripId" = ${trip.id} FOR UPDATE
  `;
  if (locked.length === 0) throw new BatchNotFoundError(batchId);
  return tx.volunteerBatch.findUniqueOrThrow({ where: { id: batchId } });
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
      const payment = paymentOfConfirmed(registration);
      const refund = await refundTripFee(tx, trip, { batch, payment }, 'batch cancel', actor.userId, now);
      // A full Refund of a settled Trip Fee is never zero.
      if (refund) refunds.push({ registrationId: registration.id, refundId: refund.id, amount: refund.amount });
    }
    return { batch: cancelled, refunds };
  });
}

/**
 * How long a HOLD Registration keeps its seat while its Trip Fee is being
 * paid. An open parameter: no spec value pins it.
 */
export const HOLD_WINDOW_MS = 30 * 60 * 1000;

/** The Registration statuses that occupy a seat on their Batch. */
const LIVE_REGISTRATION_STATUSES: RegistrationStatus[] = [RegistrationStatus.HOLD, RegistrationStatus.CONFIRMED];

/**
 * Every HOLD on the Batch whose window has passed becomes EXPIRED, freeing
 * its seat. Called with the Batch lock held, so the seat count taken next
 * sees the freed seats. There is still no scheduler for this one: it runs
 * at the start of every hold on the Batch, and nothing else calls it. The
 * comparison to releaseMaturedEscrow (src/lib/money/escrow.ts) is the
 * other way round now -- that sweep runs at the start of a payout request
 * and is also a phase of `runScheduledJobs` (src/lib/scheduled-jobs.ts),
 * which does not expire lapsed holds. The Payment of an expired hold is
 * left alone: a late settlement of it is the webhook's business.
 */
async function expireLapsedHolds(tx: Tx, batchId: string, now: Date): Promise<void> {
  await tx.registration.updateMany({
    where: { batchId, status: RegistrationStatus.HOLD, holdExpiresAt: { lte: now } },
    data: { status: RegistrationStatus.EXPIRED },
  });
}

export type HoldRegistrationResult = { registration: Registration; tripFeeAmount: number };

/**
 * A Volunteer takes a seat on an OPEN Batch of an ACTIVE Trip before its
 * registrationDeadline: a HOLD Registration that keeps the seat for
 * HOLD_WINDOW_MS while the Trip Fee is charged (CONTEXT.md, Registration).
 * Returns the Trip Fee to charge, read under the same lock.
 *
 * Locks Trip → Batch, then expires lapsed holds and counts the seats, so
 * two holds racing for the last seat serialise on the Batch lock and the
 * second sees the first.
 *
 * Refusals: TripNotFoundError and BatchNotFoundError (404), the latter
 * also for a Batch of another Trip; TripNotTakingRegistrationsError,
 * BatchNotTakingRegistrationsError, RegistrationDeadlinePassedError,
 * BatchFullError and AlreadyRegisteredError (400).
 */
export async function holdRegistration(
  prisma: PrismaClient,
  params: { tripId: string; batchId: string; volunteerId: string; now?: Date },
): Promise<HoldRegistrationResult> {
  const { tripId, batchId, volunteerId, now = new Date() } = params;
  return prisma.$transaction(async (tx: Tx) => {
    const trip = await lockTrip(tx, tripId, now);
    // Judged in the order the hold route always answered: which Batch,
    // then the Batch's status, then the Trip's, then the deadline.
    const batch = await lockBatch(tx, trip, batchId);
    if (batch.status !== VolunteerBatchStatus.OPEN) throw new BatchNotTakingRegistrationsError(batch.status);
    if (trip.effectiveStatus !== VolunteerTripStatus.ACTIVE) {
      throw new TripNotTakingRegistrationsError(trip.effectiveStatus);
    }
    if (batch.registrationDeadline <= now) throw new RegistrationDeadlinePassedError();

    await expireLapsedHolds(tx, batch.id, now);
    const occupied = await tx.registration.count({
      where: { batchId: batch.id, status: { in: LIVE_REGISTRATION_STATUSES } },
    });
    if (occupied >= batch.maxQuota) throw new BatchFullError();
    const existing = await tx.registration.findFirst({
      where: { volunteerId, batchId: batch.id, status: { in: LIVE_REGISTRATION_STATUSES } },
      select: { id: true },
    });
    if (existing) throw new AlreadyRegisteredError();

    const registration = await tx.registration.create({
      data: {
        volunteerId,
        batchId: batch.id,
        status: RegistrationStatus.HOLD,
        holdExpiresAt: new Date(now.getTime() + HOLD_WINDOW_MS),
      },
    });
    const { tripFeeAmount } = await tx.volunteerTrip.findUniqueOrThrow({ where: { id: trip.id } });
    return { registration, tripFeeAmount };
  });
}

type LockedRegistration = Registration & { batch: VolunteerBatch; payment: Payment | null };

/**
 * Find a Registration's Trip, then take the locks a Registration operation
 * needs: the Trip (1), then the Registration row itself (3), and read it
 * with its Batch and Payment only once both are held. Its Batch is read,
 * not locked: every Batch status change holds the Trip lock already held
 * here. The Trip id, and whose the Registration is, are read before any
 * lock (`beforeLocking` may refuse on them); neither ever changes.
 */
async function lockRegistration(
  tx: Tx,
  registrationId: string,
  now: Date,
  beforeLocking?: (registration: Registration) => void,
): Promise<{ trip: LockedTrip; registration: LockedRegistration }> {
  const found = await tx.registration.findUnique({ where: { id: registrationId }, include: { batch: true } });
  if (!found) throw new RegistrationNotFoundError(registrationId);
  beforeLocking?.(found);
  const trip = await lockTrip(tx, found.batch.tripId, now);
  await tx.$queryRaw`SELECT id FROM "Registration" WHERE id = ${registrationId} FOR UPDATE`;
  const registration = await tx.registration.findUnique({
    where: { id: registrationId },
    include: { batch: true, payment: true },
  });
  if (!registration) throw new RegistrationNotFoundError(registrationId);
  return { trip, registration };
}

/**
 * Write a Registration's status, predicated on the status read under its
 * lock; a miss means a writer that skipped the lock, and is refused rather
 * than overwritten.
 */
async function writeRegistrationStatus(
  tx: Tx,
  registration: Registration,
  to: RegistrationStatus,
  onMiss: () => Error,
): Promise<Registration> {
  const written = await tx.registration.updateMany({
    where: { id: registration.id, status: registration.status },
    data: { status: to },
  });
  if (written.count === 0) throw onMiss();
  return { ...registration, status: to };
}

/** A CONFIRMED Registration always has a settled Payment (schema.prisma). */
function paymentOfConfirmed(registration: { id: string; payment: Payment | null }): Payment {
  if (!registration.payment) throw new Error(`CONFIRMED Registration ${registration.id} has no Payment`);
  return registration.payment;
}

/**
 * Refund a paid Registration's Trip Fee by the Trip Fee Refund policy's
 * `refundCase`: a REQUESTED Refund, frozen at once, of the amount and
 * reason the policy decides, or none when it owes nothing. Takes the
 * Payment lock (4) inside `createRefund`, after re-entering the Trip lock
 * already held.
 */
async function refundTripFee(
  tx: Tx,
  trip: LockedTrip,
  paid: { batch: VolunteerBatch; payment: Payment },
  refundCase: TripFeeRefundCase,
  requestedById: string,
  now: Date,
): Promise<Refund | null> {
  const { amount, reason } = tripFeeRefund(paid, refundCase, now);
  if (amount === 0) return null;
  return createRefund(tx, {
    subject: { type: 'trip', tripId: trip.id },
    paymentId: paid.payment.id,
    amount,
    reason,
    requestedById,
  });
}

const NOT_OWN_REGISTRATION = 'Hanya Volunteer pemilik Registrasi ini yang dapat membatalkannya.';

export type CancelRegistrationResult = { registration: Registration; refund: Refund | null };

/**
 * A Volunteer cancels their own HOLD or CONFIRMED Registration. A CONFIRMED
 * one is refunded by the Trip Fee Refund policy's 'volunteer cancel' tier,
 * as a REQUESTED Refund frozen at once and requested by the Volunteer; no
 * Refund at all when the tier owes nothing, or for a HOLD (nothing paid).
 *
 * Locks Trip → Registration → Payment (the last inside `createRefund`).
 *
 * Refusals: RegistrationNotFoundError (404); NotAuthorizedError (403) for
 * anyone but the Registration's Volunteer, before anything is locked;
 * RegistrationNotCancellableError (400) from any other status, including a
 * cancel or expiry committed before this call got the lock, so nothing is
 * refunded twice; BatchAlreadyCompletedError (400).
 */
export async function cancelRegistration(
  prisma: PrismaClient,
  params: { registrationId: string; actor: { userId: string }; now?: Date },
): Promise<CancelRegistrationResult> {
  const { registrationId, actor, now = new Date() } = params;
  return prisma.$transaction(async (tx: Tx) => {
    const { trip, registration } = await lockRegistration(tx, registrationId, now, (found) => {
      if (found.volunteerId !== actor.userId) throw new NotAuthorizedError(NOT_OWN_REGISTRATION);
    });
    const current = registration.status;
    if (!LIVE_REGISTRATION_STATUSES.includes(current)) throw new RegistrationNotCancellableError(current);
    if (registration.batch.status === VolunteerBatchStatus.COMPLETED) throw new BatchAlreadyCompletedError();

    const cancelled = await writeRegistrationStatus(
      tx,
      registration,
      RegistrationStatus.CANCELLED,
      () => new RegistrationNotCancellableError(current),
    );
    if (current === RegistrationStatus.HOLD) return { registration: cancelled, refund: null };

    const paid = { batch: registration.batch, payment: paymentOfConfirmed(registration) };
    const refund = await refundTripFee(tx, trip, paid, 'volunteer cancel', actor.userId, now);
    return { registration: cancelled, refund };
  });
}

/**
 * What a Trip Fee Settlement found its Registration in:
 *   - 'confirmed': it was HOLD and now holds its seat;
 *   - 'cancelled': it was cancelled before the Trip Fee settled, so the
 *     money is owed back in full (`refundLateSettlement`);
 *   - 'lapsed': its hold expired first; the money is collected with no
 *     seat, so it is owed back in full too (`refundLateSettlement`, ticket
 *     40). The seat is not handed out, even if one is free.
 */
export type ConfirmRegistrationOutcome = 'confirmed' | 'cancelled' | 'lapsed';

/**
 * Settlement confirms a HOLD Registration. Runs inside the webhook's own
 * Settlement transaction, after it has written the Payment, and so takes
 * no lock of its own: the Registration write here is the one step outside
 * the lock order, and it cannot deadlock against it. Every locking writer
 * that goes on to a Payment (Volunteer cancel, Batch cancel) does so only
 * for a CONFIRMED Registration, whose Payment is already PAID and so is
 * never written by a Settlement; the Payment a Settlement writes belongs to
 * a HOLD, which those writers lock but never follow to its Payment.
 */
export async function confirmRegistration(
  tx: Tx,
  params: { registrationId: string },
): Promise<{ outcome: ConfirmRegistrationOutcome }> {
  const { registrationId } = params;
  const confirmed = await tx.registration.updateMany({
    where: { id: registrationId, status: RegistrationStatus.HOLD },
    data: { status: RegistrationStatus.CONFIRMED },
  });
  if (confirmed.count > 0) return { outcome: 'confirmed' };
  const current = await tx.registration.findUnique({ where: { id: registrationId }, select: { status: true } });
  return { outcome: current?.status === RegistrationStatus.CANCELLED ? 'cancelled' : 'lapsed' };
}

/**
 * The Trip Fee's Payment failed or expired at the provider: a Registration
 * still on HOLD loses its seat. Runs inside the webhook's own transaction,
 * after it has written the Payment, as `confirmRegistration` does and for
 * the same reason takes no lock. Any other status is left as it is.
 */
export async function expireRegistrationHold(tx: Tx, params: { registrationId: string }): Promise<void> {
  await tx.registration.updateMany({
    where: { id: params.registrationId, status: RegistrationStatus.HOLD },
    data: { status: RegistrationStatus.EXPIRED },
  });
}

/**
 * A Trip Fee settled after its Registration was cancelled (by the Volunteer
 * or with its Batch) or after its hold expired: the Trip Fee Refund
 * policy's 'late settlement' and 'lapsed settlement' cases refund it in
 * full, requested in the Volunteer's name. Called by the
 * webhook once its Settlement has committed, in a transaction of its own,
 * so the locks run in order: Trip → Registration → Payment (the last
 * inside `createRefund`). Refunds nothing unless the Registration, read
 * under its lock, is CANCELLED or EXPIRED; a CONFIRMED one keeps its seat.
 *
 * Idempotent by `createRefund`, not by anything here: it counts every
 * Refund on the Payment not REJECTED or FAILED, so a second full Refund
 * throws RefundExceedsRemainingError instead of being written.
 */
export async function refundLateSettlement(
  prisma: PrismaClient,
  params: { registrationId: string; now?: Date },
): Promise<{ refund: Refund | null }> {
  const { registrationId, now = new Date() } = params;
  return prisma.$transaction(async (tx: Tx) => {
    const { trip, registration } = await lockRegistration(tx, registrationId, now);
    const refundCase: TripFeeRefundCase | null =
      registration.status === RegistrationStatus.CANCELLED
        ? 'late settlement'
        : registration.status === RegistrationStatus.EXPIRED
          ? 'lapsed settlement'
          : null;
    if (!refundCase || !registration.payment) return { refund: null };
    const { batch, payment } = registration;
    const refund = await refundTripFee(tx, trip, { batch, payment }, refundCase, registration.volunteerId, now);
    return { refund };
  });
}
