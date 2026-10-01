import type { RegistrationStatus, VolunteerBatchStatus, VolunteerTripStatus } from '@/generated/prisma/client';
import { DomainError, type TripErrorCode } from '@/lib/domain-errors';

/**
 * The typed refusals of a Volunteer Trip's own lifecycle (ADR 0014: a Trip
 * is not a Campaign, so these are not Campaign lifecycle errors). Each
 * carries a stable `code` and an Indonesian `message`, and answers HTTP
 * through `domainErrorToHttp` (src/lib/domain-errors.ts).
 */
export abstract class TripError extends DomainError {
  abstract override readonly code: TripErrorCode;
}

/** No Volunteer Trip has this id. 404 through `domainErrorToHttp`. */
export class TripNotFoundError extends TripError {
  readonly code = 'TRIP_NOT_FOUND';
  constructor(readonly tripId: string) {
    super('Volunteer trip tidak ditemukan');
    this.name = 'TripNotFoundError';
  }
}

/**
 * A Fundraiser submits only a Draft or Rejected Volunteer Trip. Raised when
 * the Trip, read under its row lock, is in any other status: already
 * Submitted (a second submit, or one that lost the race), or past review.
 * 409 through `domainErrorToHttp`.
 */
export class TripNotEditableError extends TripError {
  readonly code = 'TRIP_NOT_EDITABLE';
  constructor(readonly currentStatus: VolunteerTripStatus) {
    super('Volunteer Trip ini tidak bisa diubah atau diajukan pada status ini. Muat ulang halaman lalu periksa kembali.');
    this.name = 'TripNotEditableError';
  }
}

/**
 * A Verifier approves or rejects only a Submitted Volunteer Trip. Raised
 * when the Trip was read in another status, and when another Verifier's
 * decision won the race to the predicated write; the message fits both, as
 * InvalidPayoutStatusError's does (src/lib/money/errors.ts).
 */
export class TripNotSubmittedError extends TripError {
  readonly code = 'TRIP_NOT_SUBMITTED';
  constructor() {
    super(
      'Volunteer Trip ini tidak sedang menunggu keputusan Verifier. Muat ulang halaman lalu periksa kembali.',
    );
    this.name = 'TripNotSubmittedError';
  }
}

/**
 * A Verifier rejects a Submitted Volunteer Trip with a reason the Fundraiser
 * can act on: blank, or longer than the bound, is refused. 422 through
 * `domainErrorToHttp`: the Verifier fixes it by filling the field in.
 */
export class TripRejectionReasonInvalidError extends TripError {
  readonly code = 'TRIP_REJECTION_REASON_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'TripRejectionReasonInvalidError';
  }
}

/**
 * A Batch is added only to a Trip that can still run one: any status but
 * Cancelled or Completed. 400 through `domainErrorToHttp`.
 */
export class TripNotAcceptingBatchesError extends TripError {
  readonly code = 'TRIP_NOT_ACCEPTING_BATCHES';
  constructor(readonly currentStatus: VolunteerTripStatus) {
    super('Tidak bisa menambah batch pada trip dengan status ini');
    this.name = 'TripNotAcceptingBatchesError';
  }
}

/** The fields of a Volunteer Batch a refusal can name. */
export type BatchField = 'endDate' | 'registrationDeadline' | 'minQuota';

/**
 * A Batch's dates or quotas contradict each other, as sent or combined with
 * what is stored: endDate before startDate, registrationDeadline after
 * startDate, or minQuota above maxQuota. Names the field, so a form can put
 * the message beside it. 400 through `domainErrorToHttp`.
 */
export class BatchFieldsInvalidError extends TripError {
  readonly code = 'BATCH_FIELDS_INVALID';
  constructor(
    readonly field: BatchField,
    message: string,
  ) {
    super(message);
    this.name = 'BatchFieldsInvalidError';
  }
}

/** No Volunteer Batch has this id on this Trip. 404 through `domainErrorToHttp`. */
export class BatchNotFoundError extends TripError {
  readonly code = 'BATCH_NOT_FOUND';
  constructor(readonly batchId: string) {
    super('Volunteer batch tidak ditemukan');
    this.name = 'BatchNotFoundError';
  }
}

/**
 * A Batch is edited, cancelled or completed only while OPEN. Raised when
 * the Batch, read under its row lock, is in any other status, including one
 * a concurrent cancel or complete committed first. 409 through
 * `domainErrorToHttp`.
 */
export class BatchNotOpenError extends TripError {
  readonly code = 'BATCH_NOT_OPEN';
  constructor(readonly currentStatus: VolunteerBatchStatus) {
    super('Batch sudah tidak berstatus OPEN. Muat ulang halaman lalu periksa kembali.');
    this.name = 'BatchNotOpenError';
  }
}

/**
 * A Fundraiser cancels only a Batch that has not reached its minimum quota
 * of CONFIRMED Registrations (CONTEXT.md, Volunteer Batch). 400 through
 * `domainErrorToHttp`.
 */
export class BatchMinQuotaMetError extends TripError {
  readonly code = 'BATCH_MIN_QUOTA_MET';
  constructor() {
    super('Batch sudah mencapai kuota minimum, tidak bisa dibatalkan');
    this.name = 'BatchMinQuotaMetError';
  }
}

/** A Batch is completed only once its endDate has passed. 400 through `domainErrorToHttp`. */
export class BatchNotEndedError extends TripError {
  readonly code = 'BATCH_NOT_ENDED';
  constructor() {
    super('Batch belum bisa diselesaikan sebelum endDate');
    this.name = 'BatchNotEndedError';
  }
}

/** A Volunteer registers only on an ACTIVE Trip. 400 through `domainErrorToHttp`. */
export class TripNotTakingRegistrationsError extends TripError {
  readonly code = 'TRIP_NOT_TAKING_REGISTRATIONS';
  constructor(readonly currentStatus: VolunteerTripStatus) {
    super('Trip ini tidak menerima registrasi');
    this.name = 'TripNotTakingRegistrationsError';
  }
}

/**
 * A Volunteer registers only on an OPEN Batch. 400 through
 * `domainErrorToHttp`, unlike BatchNotOpenError's 409: the Volunteer raced
 * no one, the Batch is simply not taking people.
 */
export class BatchNotTakingRegistrationsError extends TripError {
  readonly code = 'BATCH_NOT_TAKING_REGISTRATIONS';
  constructor(readonly currentStatus: VolunteerBatchStatus) {
    super('Batch ini tidak menerima registrasi');
    this.name = 'BatchNotTakingRegistrationsError';
  }
}

/** The Batch's registrationDeadline has passed. 400 through `domainErrorToHttp`. */
export class RegistrationDeadlinePassedError extends TripError {
  readonly code = 'REGISTRATION_DEADLINE_PASSED';
  constructor() {
    super('Pendaftaran batch ini sudah ditutup');
    this.name = 'RegistrationDeadlinePassedError';
  }
}

/** Every seat of the Batch is held or confirmed. 400 through `domainErrorToHttp`. */
export class BatchFullError extends TripError {
  readonly code = 'BATCH_FULL';
  constructor() {
    super('Batch ini sudah penuh');
    this.name = 'BatchFullError';
  }
}

/**
 * The Volunteer already holds or has confirmed a seat on this Batch. 400
 * through `domainErrorToHttp`.
 */
export class AlreadyRegisteredError extends TripError {
  readonly code = 'ALREADY_REGISTERED';
  constructor() {
    super('Anda sudah memiliki registrasi aktif pada batch ini');
    this.name = 'AlreadyRegisteredError';
  }
}

/** No Registration has this id. 404 through `domainErrorToHttp`. */
export class RegistrationNotFoundError extends TripError {
  readonly code = 'REGISTRATION_NOT_FOUND';
  constructor(readonly registrationId: string) {
    super('Registrasi tidak ditemukan');
    this.name = 'RegistrationNotFoundError';
  }
}

/**
 * A Volunteer cancels only a HOLD or CONFIRMED Registration. Raised when the
 * Registration, read under its row lock, is in any other status, including
 * a cancel or expiry committed first. 400 through `domainErrorToHttp`.
 */
export class RegistrationNotCancellableError extends TripError {
  readonly code = 'REGISTRATION_NOT_CANCELLABLE';
  constructor(readonly currentStatus: RegistrationStatus) {
    super('Registrasi tidak bisa dibatalkan pada status ini');
    this.name = 'RegistrationNotCancellableError';
  }
}

/**
 * A Registration on a COMPLETED Batch is not cancelled: the trip already
 * ran. 400 through `domainErrorToHttp`.
 */
export class BatchAlreadyCompletedError extends TripError {
  readonly code = 'BATCH_ALREADY_COMPLETED';
  constructor() {
    super('Registrasi tidak bisa dibatalkan karena Batch sudah selesai');
    this.name = 'BatchAlreadyCompletedError';
  }
}

/**
 * An Admin suspends only an ACTIVE Volunteer Trip. Raised when the Trip, read
 * under its row lock, is in any other status, including one a competing
 * Suspension already changed. 409 through `domainErrorToHttp`.
 */
export class TripNotSuspendableError extends TripError {
  readonly code = 'TRIP_NOT_SUSPENDABLE';
  constructor(readonly currentStatus: VolunteerTripStatus) {
    super('Volunteer Trip ini tidak bisa ditangguhkan pada status ini. Muat ulang halaman lalu periksa kembali.');
    this.name = 'TripNotSuspendableError';
  }
}

/** An Admin lifts a Suspension only on a SUSPENDED Volunteer Trip. 409 through `domainErrorToHttp`. */
export class TripNotSuspendedError extends TripError {
  readonly code = 'TRIP_NOT_SUSPENDED';
  constructor(readonly currentStatus: VolunteerTripStatus) {
    super('Volunteer Trip ini tidak sedang ditangguhkan. Muat ulang halaman lalu periksa kembali.');
    this.name = 'TripNotSuspendedError';
  }
}

/**
 * A SUSPENDED Trip with no SUSPENDED log row: the status to return to is
 * unknown, so lifting is refused rather than guessed (the Campaign's
 * UnrecordedSuspensionError, for a Trip). 409 through `domainErrorToHttp`.
 */
export class TripSuspensionUnrecordedError extends TripError {
  readonly code = 'TRIP_SUSPENSION_UNRECORDED';
  constructor() {
    super(
      'Penangguhan ini tidak tercatat di riwayat status, sehingga status Volunteer Trip sebelumnya tidak diketahui. Hubungi tim teknis untuk mencabutnya.',
    );
    this.name = 'TripSuspensionUnrecordedError';
  }
}
