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
  | "CAMPAIGN_NOT_EDITABLE"
  | "ACTIVE_CONTENT_FROZEN"
  | "VERIFICATION_REQUEST_NOT_FOUND"
  | "VERIFICATION_REQUEST_NOT_PENDING"
  | "AMOUNT_REVIEW_NOT_WITHDRAWABLE"
  | "CHANGE_REQUEST_ALREADY_PENDING"
  | "TOO_MANY_ACTIVE_CAMPAIGNS"
  | "REQUIRED_CHECKLIST_ITEMS_UNTICKED"
  | "DEADLINE_REQUIRED"
  | "DEADLINE_NOT_EDITABLE"
  | "KIND_IMMUTABLE"
  | "COLLECTING_ENTITY_REQUIRED"
  | "FUNDRAISING_PERMIT_REQUIRED"
  | "COLLECTING_ENTITY_NOT_ELIGIBLE"
  | "COLLECTING_ENTITY_ALREADY_SET"
  | "COLLECTING_ENTITY_NOT_EDITABLE"
  | "INDIVIDUAL_FUNDRAISER_KIND_NOT_ALLOWED"
  | "KIND_AUTHORISATION_REQUIRED";

export type MoneyErrorCode =
  | "DEMO_CAMPAIGN"
  | "BANK_ACCOUNT_NOT_ELIGIBLE"
  | "INSUFFICIENT_BALANCE"
  | "SELF_APPROVAL"
  | "TWO_PERSON_RULE"
  | "PAYOUT_PROOF_INVALID"
  | "REFUND_PROOF_INVALID"
  | "REFUND_DESTINATION_INVALID"
  | "REFUND_DESTINATION_MISMATCH"
  | "INVALID_PAYOUT_STATUS"
  | "INVALID_REFUND_STATUS"
  | "PAYOUT_NOT_FOUND"
  | "REFUND_NOT_FOUND"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_SUBJECT_MISMATCH"
  | "REFUND_EXCEEDS_REMAINING"
  | "REFUND_NOT_ALLOWED_FOR_KIND"
  | "DONATION_ANONYMISED"
  | "ANONYMISATION_BLOCKED_BY_OPEN_REFUND"
  | "MANUAL_CONTRIBUTION_NOT_FOUND"
  | "MANUAL_CONTRIBUTION_TARGET_INVALID"
  | "MANUAL_CONTRIBUTION_INVALID"
  | "MANUAL_CONTRIBUTION_PROOF_REQUIRED"
  | "MANUAL_CONTRIBUTION_AMOUNT_INVALID"
  | "MANUAL_CONTRIBUTION_NOT_PENDING"
  | "MANUAL_CONTRIBUTION_NOT_APPROVED"
  | "MANUAL_CONTRIBUTION_ALREADY_SPENT"
  | "PROVIDER_WITHDRAWAL_INVALID"
  | "PROVIDER_WITHDRAWAL_AMOUNT_INVALID"
  | "PROVIDER_WITHDRAWAL_PROOF_REQUIRED"
  | "PROVIDER_WITHDRAWAL_DUPLICATE"
  | "PROVIDER_WITHDRAWAL_ENTITY_NOT_FOUND"
  | "PROVIDER_BALANCE_NOT_RECORDED"
  | "PROVIDER_BALANCE_AMOUNT_INVALID"
  | "PROVIDER_BALANCE_INSUFFICIENT"
  | "PROVIDER_BALANCE_NOT_SHORT"
  | "PROVIDER_NAME_UNKNOWN";

/**
 * Refusals of a Volunteer Trip's own lifecycle, kept apart from the
 * Campaign lifecycle codes because a Trip is not a Campaign (ADR 0014).
 */
export type TripErrorCode =
  | "TRIP_NOT_FOUND"
  | "TRIP_NOT_EDITABLE"
  | "TRIP_NOT_SUBMITTED"
  | "TRIP_REJECTION_REASON_INVALID"
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
  | "BATCH_ALREADY_COMPLETED"
  | "TRIP_NOT_SUSPENDABLE"
  | "TRIP_NOT_SUSPENDED"
  | "TRIP_SUSPENSION_UNRECORDED";

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

/**
 * Refusals of the Verifier's Partner Organisation and Fundraising Permit
 * register (./partner-organisations.ts; prd-compliance 10).
 */
export type PartnerOrganisationErrorCode =
  | "PARTNER_ORGANISATION_INVALID"
  | "PARTNER_ORGANISATION_NOT_FOUND"
  | "FUNDRAISING_PERMIT_NOT_FOUND"
  | "KIND_AUTHORISATION_NOT_FOUND"
  | "FUNDRAISER_ALREADY_LINKED"
  | "OWN_PARTNER_ORGANISATION_CONFLICT";

/**
 * Refusals of the Bank Account and its Verification Request (ticket 16;
 * ADR 0018): creating, submitting, withdrawing and deleting a BankAccount,
 * and a Verifier's decision on it.
 */
export type BankAccountErrorCode =
  | "BANK_ACCOUNT_INVALID"
  | "BANK_ACCOUNT_NOT_FOUND"
  | "BANK_ACCOUNT_ALREADY_VERIFIED"
  | "BANK_ACCOUNT_VERIFICATION_ALREADY_PENDING"
  | "BANK_ACCOUNT_NOT_DELETABLE"
  | "BANK_ACCOUNT_VERIFICATION_REQUEST_NOT_FOUND"
  | "BANK_ACCOUNT_VERIFICATION_NOT_PENDING"
  | "BANK_ACCOUNT_DECISION_INVALID"
  | "OWN_BANK_ACCOUNT_CONFLICT"
  | "BANK_ACCOUNT_NOT_REVOCABLE"
  | "BANK_ACCOUNT_NOT_REINSTATABLE"
  | "BANK_ACCOUNT_REVOKED_BY_APPROVER"
  | "BANK_ACCOUNT_REINSTATED_BY_REVOKER";

/**
 * Refusals of a Usage Report -- a Fundraiser's account of one Payout's
 * money (ticket 22; PRD FFI-07a; CONTEXT.md, Usage Report) -- and of the
 * gate it puts on the next Payout on the same Campaign
 * (src/lib/usage-reports.ts, src/lib/money/payouts.ts).
 */
export type UsageReportErrorCode =
  | "USAGE_REPORT_REQUIRED"
  | "USAGE_REPORT_NOT_FOUND"
  | "USAGE_REPORT_ALREADY_EXISTS"
  | "USAGE_REPORT_PAYOUT_NOT_COMPLETED"
  | "USAGE_REPORT_INVALID"
  | "USAGE_REPORT_ALREADY_DISPUTED";

/**
 * Refusals of granting and revoking VERIFIER and ADMIN (ticket 07/20;
 * CONTEXT.md, Admin): a direct VERIFIER grant, the two-person ADMIN grant
 * (propose, confirm, withdraw), and revoking either assignment.
 */
export type AssignmentErrorCode =
  | "ASSIGNMENT_INVALID"
  | "ASSIGNMENT_ALREADY_GRANTED"
  | "ASSIGNMENT_GRANT_ALREADY_PENDING"
  | "ASSIGNMENT_GRANT_REQUEST_NOT_FOUND"
  | "ASSIGNMENT_GRANT_NOT_PENDING"
  | "ASSIGNMENT_SELF_CONFIRMATION"
  | "ASSIGNMENT_GRANT_NOT_OWN_PROPOSAL"
  | "ASSIGNMENT_SELF_REVOKE"
  | "LAST_ADMIN_ASSIGNMENT"
  | "ASSIGNMENT_NOT_HELD";

export type DomainErrorCode =
  | LifecycleErrorCode
  | MoneyErrorCode
  | TripErrorCode
  | CapacityErrorCode
  | PartnerOrganisationErrorCode
  | BankAccountErrorCode
  | AssignmentErrorCode
  | UsageReportErrorCode;

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
  // The Fundraiser could not fix it by resubmitting: a Verification Request
  // does not reopen title and description, only story and cover image stay
  // editable (verification-request 09), so this is a status conflict, not a
  // fixable precondition.
  ACTIVE_CONTENT_FROZEN: 409,
  VERIFICATION_REQUEST_NOT_FOUND: 404,
  VERIFICATION_REQUEST_NOT_PENDING: 409,
  // A second change asked while the first still waits for a Verifier.
  CHANGE_REQUEST_ALREADY_PENDING: 409,
  // A Verifikasi Tambahan is the System's, so the Fundraiser asking to
  // withdraw it is a conflict with who owns the record, not a bad input.
  AMOUNT_REVIEW_NOT_WITHDRAWABLE: 409,
  // The Fundraiser is already at the Active Campaign limit, so this approval
  // would open one more: a conflict with the Campaign's own state, which
  // clears by itself when one of theirs leaves Active.
  TOO_MANY_ACTIVE_CAMPAIGNS: 409,
  // Like MISSING_CAMPAIGN_UPDATE: an unmet precondition the actor can fix
  // (tick the items), not a status conflict another actor caused.
  REQUIRED_CHECKLIST_ITEMS_UNTICKED: 422,
  // The Fundraiser can fix it by setting a deadline, as above.
  DEADLINE_REQUIRED: 422,
  KIND_IMMUTABLE: 409,
  DEADLINE_NOT_EDITABLE: 409,
  // Unmet preconditions the actor can fix (name an entity, have a permit
  // recorded), like DEADLINE_REQUIRED.
  COLLECTING_ENTITY_REQUIRED: 422,
  FUNDRAISING_PERMIT_REQUIRED: 422,
  COLLECTING_ENTITY_NOT_ELIGIBLE: 422,
  // Another actor already assigned one, or the Campaign has moved on.
  COLLECTING_ENTITY_ALREADY_SET: 409,
  COLLECTING_ENTITY_NOT_EDITABLE: 409,
  // The Fundraiser can fix it by changing the Kind while still Draft, like
  // DEADLINE_REQUIRED; a Kind Authorisation the Verifier can record, like
  // FUNDRAISING_PERMIT_REQUIRED.
  INDIVIDUAL_FUNDRAISER_KIND_NOT_ALLOWED: 422,
  KIND_AUTHORISATION_REQUIRED: 422,
  OWN_TRIP_CONFLICT: 403,
  DEMO_CAMPAIGN: 403,
  BANK_ACCOUNT_NOT_ELIGIBLE: 403,
  INSUFFICIENT_BALANCE: 400,
  SELF_APPROVAL: 403,
  // The two-person control itself: the same Admin cannot both approve and
  // record the transfer. Not something they can fix by resending, so 403
  // like the other capacity refusals, not a 409 status conflict.
  TWO_PERSON_RULE: 403,
  // The Admin can fix this one, by filling the reference or note field the
  // message names -- the same shape as MANUAL_CONTRIBUTION_INVALID and
  // PROVIDER_WITHDRAWAL_INVALID: a field left blank or too long, not a
  // policy the request has no way to satisfy, so 400 rather than 422.
  PAYOUT_PROOF_INVALID: 400,
  // completeRefund's own twin of PAYOUT_PROOF_INVALID, same reasoning, same
  // status: the Admin fixes it by filling the reference or note field named.
  REFUND_PROOF_INVALID: 400,
  // The Donor destination an Admin typed at approval (Q7(c): bank code,
  // account name, account number -- moved here from completion): a field
  // left blank or over length, the same shape as
  // MANUAL_CONTRIBUTION_INVALID -- fixable by filling the form in properly,
  // not a policy the request has no way to satisfy.
  REFUND_DESTINATION_INVALID: 400,
  // The completing Admin's re-typed account number does not match the one
  // the approving Admin recorded (Q7(c)): a mistyped re-entry, fixable by
  // re-reading the Donor's written request, not a policy refusal -- same
  // status as REFUND_DESTINATION_INVALID.
  REFUND_DESTINATION_MISMATCH: 400,
  INVALID_PAYOUT_STATUS: 409,
  INVALID_REFUND_STATUS: 409,
  PAYOUT_NOT_FOUND: 404,
  REFUND_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_SUBJECT_MISMATCH: 404,
  REFUND_EXCEEDS_REMAINING: 400,
  // A policy refusal about the Campaign itself, not a malformed request: the
  // Campaign's Kind is what forbids the Refund, and no resend of the same
  // body changes that. 403 with the other policy refusals.
  REFUND_NOT_ALLOWED_FOR_KIND: 403,
  // Both are states the request cannot change by being resent: the Donation
  // was anonymised (ticket 36), or a Refund on it has not finished yet.
  DONATION_ANONYMISED: 409,
  ANONYMISATION_BLOCKED_BY_OPEN_REFUND: 409,
  MANUAL_CONTRIBUTION_NOT_FOUND: 404,
  // Unmet preconditions the Admin can fix by filling the form in properly,
  // like REFUND_EXCEEDS_REMAINING and DEADLINE_REQUIRED.
  MANUAL_CONTRIBUTION_TARGET_INVALID: 400,
  MANUAL_CONTRIBUTION_INVALID: 400,
  MANUAL_CONTRIBUTION_PROOF_REQUIRED: 400,
  MANUAL_CONTRIBUTION_AMOUNT_INVALID: 400,
  MANUAL_CONTRIBUTION_NOT_PENDING: 409,
  MANUAL_CONTRIBUTION_NOT_APPROVED: 409,
  // The money has already left through a Payout, so it cannot be taken back.
  MANUAL_CONTRIBUTION_ALREADY_SPENT: 409,
  // Unmet preconditions the Admin can fix by filling the form in properly:
  // the same shape as MANUAL_CONTRIBUTION_INVALID, and 400 rather than 422
  // because there is no rule being breached, only a field left empty.
  PROVIDER_WITHDRAWAL_INVALID: 400,
  PROVIDER_WITHDRAWAL_AMOUNT_INVALID: 400,
  PROVIDER_WITHDRAWAL_PROOF_REQUIRED: 400,
  // The provider's own reference for this disbursement is already recorded, so
  // the money has been claimed once and this is a second claim on it. A
  // conflict with the row that holds the reference, like
  // PARTNER_FUNDRAISER_ALREADY_LINKED.
  PROVIDER_WITHDRAWAL_DUPLICATE: 409,
  PROVIDER_WITHDRAWAL_ENTITY_NOT_FOUND: 404,
  // FFI-07: there is no provider balance API, so the Admin has to read the
  // dashboard and write the number down. An approval that supplies no reading
  // is one this system cannot check, and it answers 422 -- an unmet
  // precondition the actor can fix by opening the dashboard -- rather than
  // 400, because the field is not wrong, it is absent on purpose.
  PROVIDER_BALANCE_NOT_RECORDED: 422,
  // The reading is there and it is not a figure that column holds -- not whole
  // rupiah, not above zero, or past int4. The same 422 as the absent reading,
  // because the Admin fixes it the same way: read the dashboard again and write
  // down what it says.
  PROVIDER_BALANCE_AMOUNT_INVALID: 422,
  // The reading is there and it says the money is not there. Same 422: the
  // Admin can fix it, either by finding the shortfall or by not approving this
  // Payout yet.
  PROVIDER_BALANCE_INSUFFICIENT: 422,
  // ticket 30: the reading is there and it is NOT short of the Payout's own
  // amount, so there is nothing to record as a pending decision. The Admin
  // can fix it -- by approving instead -- so 422 like the other two reading
  // refusals, not a 409 status conflict.
  PROVIDER_BALANCE_NOT_SHORT: 422,
  // A field the Admin got wrong rather than one they left out, so 400 like
  // PROVIDER_WITHDRAWAL_INVALID -- the same fault under the same shape on the
  // withdrawal path -- and not the 422 the two reading refusals answer. The
  // Admin can fix it by choosing a registered provider, and no rule was
  // breached, only a name that names nothing.
  PROVIDER_NAME_UNKNOWN: 400,
  TRIP_NOT_FOUND: 404,
  TRIP_NOT_EDITABLE: 409,
  TRIP_NOT_SUBMITTED: 409,
  // The Verifier can fix it by writing the reason, like MISSING_CAMPAIGN_UPDATE.
  TRIP_REJECTION_REASON_INVALID: 422,
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
  TRIP_NOT_SUSPENDABLE: 409,
  TRIP_NOT_SUSPENDED: 409,
  TRIP_SUSPENSION_UNRECORDED: 409,
  PARTNER_ORGANISATION_INVALID: 400,
  PARTNER_ORGANISATION_NOT_FOUND: 404,
  FUNDRAISING_PERMIT_NOT_FOUND: 404,
  KIND_AUTHORISATION_NOT_FOUND: 404,
  FUNDRAISER_ALREADY_LINKED: 409,
  OWN_PARTNER_ORGANISATION_CONFLICT: 403,
  // A malformed or missing field the owner can fix by resending, like
  // PARTNER_ORGANISATION_INVALID.
  BANK_ACCOUNT_INVALID: 400,
  BANK_ACCOUNT_NOT_FOUND: 404,
  // Decision 1's "checked once": submitting an account that already has a
  // verifiedAt is a conflict with the account's own state.
  BANK_ACCOUNT_ALREADY_VERIFIED: 409,
  // One PENDING request per account.
  BANK_ACCOUNT_VERIFICATION_ALREADY_PENDING: 409,
  // Decision 5: verifiedAt is not null, or a request row of any outcome
  // already exists. A conflict with the row's own history, not a bad input.
  BANK_ACCOUNT_NOT_DELETABLE: 409,
  BANK_ACCOUNT_VERIFICATION_REQUEST_NOT_FOUND: 404,
  // The request was decided or withdrawn by someone else since it was read
  // (the same conditional-write race closeRequest guards against).
  BANK_ACCOUNT_VERIFICATION_NOT_PENDING: 409,
  // Approval is missing checkedBankCode or documentedAccountName, or a
  // rejection is missing its reason (decision 2): the Verifier can fix it by
  // filling the form in, like DEADLINE_REQUIRED.
  BANK_ACCOUNT_DECISION_INVALID: 422,
  // A Verifier tried to decide their own account (ADR 0018), the same shape
  // as OWN_CAMPAIGN_CONFLICT / OWN_TRIP_CONFLICT.
  OWN_BANK_ACCOUNT_CONFLICT: 403,
  // Ticket 11: nothing to clear -- the account already has no verifiedAt,
  // whether never verified or already revoked. A conflict with the
  // account's own state, like BANK_ACCOUNT_ALREADY_VERIFIED.
  BANK_ACCOUNT_NOT_REVOCABLE: 409,
  // Ticket 11: nothing to restore -- the account's latest revoke/reinstate
  // row is not a REVOKED one.
  BANK_ACCOUNT_NOT_REINSTATABLE: 409,
  // Ticket 11, owner decision (b): the Verifier who approved the account
  // may not be the one who revokes it, the same shape as
  // OWN_BANK_ACCOUNT_CONFLICT.
  BANK_ACCOUNT_REVOKED_BY_APPROVER: 403,
  // Ticket 11, owner decision (b): the Verifier who revoked the account may
  // not be the one who reinstates it.
  BANK_ACCOUNT_REINSTATED_BY_REVOKER: 403,
  // A malformed or missing `assignment` value, fixable by resending.
  ASSIGNMENT_INVALID: 400,
  // The grantee already holds this assignment; proposing or granting again
  // is a conflict with the row that already exists, like
  // BANK_ACCOUNT_ALREADY_VERIFIED.
  ASSIGNMENT_ALREADY_GRANTED: 409,
  // One PENDING AssignmentGrantRequest per grantee (ticket 07/20 answer),
  // the same shape as BANK_ACCOUNT_VERIFICATION_ALREADY_PENDING.
  ASSIGNMENT_GRANT_ALREADY_PENDING: 409,
  ASSIGNMENT_GRANT_REQUEST_NOT_FOUND: 404,
  // The request was already confirmed or withdrawn, possibly by a
  // concurrent request that committed first -- the same conditional-write
  // race BANK_ACCOUNT_VERIFICATION_NOT_PENDING guards against.
  ASSIGNMENT_GRANT_NOT_PENDING: 409,
  // The two-person control itself (ticket 07/20 decision): the proposer or
  // the grantee may not also be the confirming Admin. Not fixable by
  // resending, so 403 like TWO_PERSON_RULE, not a 409 status conflict.
  ASSIGNMENT_SELF_CONFIRMATION: 403,
  // Only the proposer may withdraw their own pending proposal.
  ASSIGNMENT_GRANT_NOT_OWN_PROPOSAL: 403,
  // Nobody may revoke their own assignment, of either kind (ticket 07/20
  // decision) -- the same shape as OWN_CAMPAIGN_CONFLICT / OWN_TRIP_CONFLICT.
  ASSIGNMENT_SELF_REVOKE: 403,
  // The last ADMIN cannot be revoked: a conflict with the platform's own
  // state (headcount), not a bad input.
  LAST_ADMIN_ASSIGNMENT: 409,
  ASSIGNMENT_NOT_HELD: 404,
  // A conflict with the Campaign's own Payout history, like
  // TOO_MANY_ACTIVE_CAMPAIGNS: it clears by itself once the blocking Payout
  // gets an undisputed Usage Report, never by resending this same request.
  USAGE_REPORT_REQUIRED: 409,
  USAGE_REPORT_NOT_FOUND: 404,
  // One Usage Report per Payout (the schema's own unique payoutId): a second
  // submission is a conflict with the row that already exists, like
  // BANK_ACCOUNT_ALREADY_VERIFIED.
  USAGE_REPORT_ALREADY_EXISTS: 409,
  // A Fundraiser can only report on money that has actually moved; this
  // clears once the Payout reaches COMPLETED, not by resending.
  USAGE_REPORT_PAYOUT_NOT_COMPLETED: 409,
  // Malformed or missing fields the Fundraiser can fix by resending: narasi
  // kosong, foto kurang dari satu, atau rincian yang tidak menjumlah ke
  // nominal Payout -- the same shape as MANUAL_CONTRIBUTION_INVALID.
  USAGE_REPORT_INVALID: 400,
  // Already marked dipertanyakan; there is no code path that lifts a
  // dispute, so a second one is a conflict with the row's own history, like
  // BANK_ACCOUNT_ALREADY_VERIFIED.
  USAGE_REPORT_ALREADY_DISPUTED: 409,
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
