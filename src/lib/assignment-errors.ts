import { DomainError, type AssignmentErrorCode } from "./domain-errors";

/**
 * The typed refusals of granting and revoking VERIFIER and ADMIN (ticket
 * 07/20; CONTEXT.md, Admin). Kept apart from the command module
 * (./assignments.ts), the same split bank-account-verification-errors.ts
 * uses, so nothing here needs an import cycle back to it.
 *
 * Every refusal answers HTTP through `domainErrorToHttp`
 * (./domain-errors.ts), the one mapping every lifecycle and money route
 * shares.
 */
export abstract class AssignmentError extends DomainError {
  abstract override readonly code: AssignmentErrorCode;
}

export { domainErrorToHttp, type AssignmentErrorCode } from "./domain-errors";

/** The `assignment` field is missing or not one of VERIFIER / ADMIN. */
export class AssignmentInvalidError extends AssignmentError {
  readonly code = "ASSIGNMENT_INVALID";
  constructor() {
    super("Assignment tidak valid.");
    this.name = "AssignmentInvalidError";
  }
}

/** The grantee already holds this assignment. */
export class AssignmentAlreadyGrantedError extends AssignmentError {
  readonly code = "ASSIGNMENT_ALREADY_GRANTED";
  constructor() {
    super("Pengguna ini sudah memegang assignment tersebut.");
    this.name = "AssignmentAlreadyGrantedError";
  }
}

/** At most one PENDING AssignmentGrantRequest per grantee (ticket 07/20). */
export class AssignmentGrantAlreadyPendingError extends AssignmentError {
  readonly code = "ASSIGNMENT_GRANT_ALREADY_PENDING";
  constructor() {
    super("Masih ada pengajuan grant ADMIN yang menunggu konfirmasi Admin lain untuk pengguna ini.");
    this.name = "AssignmentGrantAlreadyPendingError";
  }
}

export class AssignmentGrantRequestNotFoundError extends AssignmentError {
  readonly code = "ASSIGNMENT_GRANT_REQUEST_NOT_FOUND";
  constructor() {
    super("Pengajuan grant ADMIN tidak ditemukan.");
    this.name = "AssignmentGrantRequestNotFoundError";
  }
}

/**
 * The request is no longer PENDING: already confirmed or withdrawn,
 * possibly by a concurrent request that committed first (the same
 * conditional-write race BankAccountVerificationNotPendingError guards
 * against).
 */
export class AssignmentGrantNotPendingError extends AssignmentError {
  readonly code = "ASSIGNMENT_GRANT_NOT_PENDING";
  constructor() {
    super("Pengajuan grant ADMIN ini sudah tidak berstatus menunggu.");
    this.name = "AssignmentGrantNotPendingError";
  }
}

/**
 * The two-person control itself (ticket 07/20 decision): the confirming
 * Admin may be neither the one who proposed the grant nor its grantee.
 */
export class AssignmentSelfConfirmationError extends AssignmentError {
  readonly code = "ASSIGNMENT_SELF_CONFIRMATION";
  constructor() {
    super(
      "Grant ADMIN membutuhkan dua Admin berbeda: Admin yang mengonfirmasi tidak boleh sama dengan yang mengajukan maupun yang menerima assignment."
    );
    this.name = "AssignmentSelfConfirmationError";
  }
}

/** Only the proposer may withdraw their own pending proposal. */
export class AssignmentGrantNotOwnProposalError extends AssignmentError {
  readonly code = "ASSIGNMENT_GRANT_NOT_OWN_PROPOSAL";
  constructor() {
    super("Hanya Admin yang mengajukan yang dapat menarik pengajuan grant ini.");
    this.name = "AssignmentGrantNotOwnProposalError";
  }
}

/** Nobody may revoke their own assignment, of either kind (ticket 07/20). */
export class AssignmentSelfRevokeError extends AssignmentError {
  readonly code = "ASSIGNMENT_SELF_REVOKE";
  constructor(assignment: string) {
    super(`Anda tidak dapat mencabut assignment ${assignment} milik Anda sendiri.`);
    this.name = "AssignmentSelfRevokeError";
  }
}

/** The last ADMIN assignment may never be revoked (row-locked headcount guard). */
export class LastAdminAssignmentError extends AssignmentError {
  readonly code = "LAST_ADMIN_ASSIGNMENT";
  constructor() {
    super("Tidak dapat mencabut assignment ADMIN yang terakhir.");
    this.name = "LastAdminAssignmentError";
  }
}

/** The target user does not currently hold this assignment. */
export class AssignmentNotHeldError extends AssignmentError {
  readonly code = "ASSIGNMENT_NOT_HELD";
  constructor() {
    super("Pengguna ini tidak memegang assignment tersebut.");
    this.name = "AssignmentNotHeldError";
  }
}
