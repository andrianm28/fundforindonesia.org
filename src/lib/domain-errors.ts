/**
 * The typed refusals of the lifecycle module and the money layer, and their
 * one HTTP mapping. A refusal carries a stable `code` for clients and an
 * Indonesian `message` for the person who acted; `domainErrorToHttp` is the
 * one place a refusal becomes an HTTP status, so every route answers the
 * same refusal the same way.
 *
 * This file imports nothing, so the lifecycle errors
 * (./campaign-lifecycle-errors.ts), the subject guard (./subject-guard.ts),
 * the money errors (./money/errors.ts), the Volunteer Trip errors
 * (./volunteer-trip-errors.ts) and the Capacity judgement (./capacity.ts)
 * can all extend it without an import cycle.
 */
export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
}

export type LifecycleErrorCode =
  | "VALIDATION"
  | "SAME_ADMIN_LIFT"
  | "CAMPAIGN_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONCURRENT_TRANSITION"
  | "PAYOUT_ALREADY_COMPLETED"
  | "CANCELLATION_ALREADY_PENDING"
  | "MISSING_CAMPAIGN_UPDATE"
  | "CANCELLATION_REQUEST_NOT_FOUND"
  | "CANCELLATION_NOT_PENDING"
  | "FLAG_NOT_FOUND"
  | "FLAG_ALREADY_RESOLVED"
  | "PAYOUT_NOT_ALLOWED_FOR_STATUS"
  | "CAMPAIGN_NOT_EDITABLE";

export type MoneyErrorCode =
  | "DEMO_CAMPAIGN"
  | "BANK_ACCOUNT_NOT_ELIGIBLE"
  | "INSUFFICIENT_BALANCE"
  | "SELF_APPROVAL"
  | "INVALID_PAYOUT_STATUS"
  | "INVALID_REFUND_STATUS"
  | "PAYOUT_NOT_FOUND"
  | "REFUND_NOT_FOUND"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_SUBJECT_MISMATCH"
  | "REFUND_EXCEEDS_REMAINING";

/**
 * Refusals of a Volunteer Trip's own lifecycle, kept apart from the
 * Campaign lifecycle codes because a Trip is not a Campaign (ADR 0014).
 */
export type TripErrorCode =
  | "TRIP_NOT_FOUND"
  | "TRIP_NOT_EDITABLE"
  | "TRIP_NOT_SUBMITTED"
  | "TRIP_NOT_ACCEPTING_BATCHES"
  | "BATCH_FIELDS_INVALID"
  | "BATCH_NOT_FOUND"
  | "BATCH_NOT_OPEN"
  | "BATCH_MIN_QUOTA_MET"
  | "BATCH_NOT_ENDED"
  | "TRIP_NOT_TAKING_REGISTRATIONS"
  | "BATCH_NOT_TAKING_REGISTRATIONS"
  | "REGISTRATION_DEADLINE_PASSED"
  | "BATCH_FULL"
  | "ALREADY_REGISTERED"
  | "REGISTRATION_NOT_FOUND"
  | "REGISTRATION_NOT_CANCELLABLE"
  | "BATCH_ALREADY_COMPLETED";

/**
 * The Capacity judgement's refusals (./capacity.ts; CONTEXT.md, Capacity),
 * for a Campaign and a Volunteer Trip alike:
 * - NOT_AUTHORIZED (NotAuthorizedError): missing the assignment the
 *   Capacity needs, or not the subject's Fundraiser;
 * - OWN_CAMPAIGN_CONFLICT / OWN_TRIP_CONFLICT (OwnSubjectConflictError):
 *   acting as Admin or Verifier on your own subject, two codes so API
 *   clients keep telling the subjects apart.
 */
export type CapacityErrorCode = "NOT_AUTHORIZED" | "OWN_CAMPAIGN_CONFLICT" | "OWN_TRIP_CONFLICT";

export type DomainErrorCode =
  | LifecycleErrorCode
  | MoneyErrorCode
  | TripErrorCode
  | CapacityErrorCode;

const HTTP_STATUS: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  NOT_AUTHORIZED: 403,
  OWN_CAMPAIGN_CONFLICT: 403,
  SAME_ADMIN_LIFT: 403,
  CAMPAIGN_NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  CONCURRENT_TRANSITION: 409,
  PAYOUT_ALREADY_COMPLETED: 409,
  CANCELLATION_ALREADY_PENDING: 409,
  MISSING_CAMPAIGN_UPDATE: 422,
  CANCELLATION_REQUEST_NOT_FOUND: 404,
  CANCELLATION_NOT_PENDING: 409,
  FLAG_NOT_FOUND: 404,
  FLAG_ALREADY_RESOLVED: 409,
  PAYOUT_NOT_ALLOWED_FOR_STATUS: 409,
  CAMPAIGN_NOT_EDITABLE: 409,
  OWN_TRIP_CONFLICT: 403,
  DEMO_CAMPAIGN: 403,
  BANK_ACCOUNT_NOT_ELIGIBLE: 403,
  INSUFFICIENT_BALANCE: 400,
  SELF_APPROVAL: 403,
  INVALID_PAYOUT_STATUS: 409,
  INVALID_REFUND_STATUS: 409,
  PAYOUT_NOT_FOUND: 404,
  REFUND_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_SUBJECT_MISMATCH: 404,
  REFUND_EXCEEDS_REMAINING: 400,
  TRIP_NOT_FOUND: 404,
  TRIP_NOT_EDITABLE: 409,
  TRIP_NOT_SUBMITTED: 409,
  TRIP_NOT_ACCEPTING_BATCHES: 400,
  BATCH_FIELDS_INVALID: 400,
  BATCH_NOT_FOUND: 404,
  BATCH_NOT_OPEN: 409,
  BATCH_MIN_QUOTA_MET: 400,
  BATCH_NOT_ENDED: 400,
  TRIP_NOT_TAKING_REGISTRATIONS: 400,
  BATCH_NOT_TAKING_REGISTRATIONS: 400,
  REGISTRATION_DEADLINE_PASSED: 400,
  BATCH_FULL: 400,
  ALREADY_REGISTERED: 400,
  REGISTRATION_NOT_FOUND: 404,
  REGISTRATION_NOT_CANCELLABLE: 400,
  BATCH_ALREADY_COMPLETED: 400,
};

/**
 * The single mapping from a refusal to an HTTP answer, shared by every
 * lifecycle and money route. Returns null for anything that is not a typed
 * refusal, so the route treats it as the unexpected failure it is.
 */
export function domainErrorToHttp(
  error: unknown
): { status: number; body: { error: string; code: DomainErrorCode } } | null {
  if (!(error instanceof DomainError)) return null;
  return {
    status: HTTP_STATUS[error.code],
    body: { error: error.message, code: error.code },
  };
}
