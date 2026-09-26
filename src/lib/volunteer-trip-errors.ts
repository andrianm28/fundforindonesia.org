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
