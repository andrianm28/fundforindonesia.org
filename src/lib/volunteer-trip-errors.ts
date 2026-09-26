import type { VolunteerTripStatus } from '@/generated/prisma/client';
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
