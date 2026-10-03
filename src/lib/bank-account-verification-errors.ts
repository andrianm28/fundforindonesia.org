import { DomainError, type BankAccountErrorCode } from "./domain-errors";

/**
 * The typed refusals of the BankAccount and BankAccountVerificationRequest
 * commands (ticket 16; ADR 0018). Kept apart from the command module
 * (./bank-account-verification.ts), the same split campaign-lifecycle-errors.ts
 * uses, so nothing here needs an import cycle back to it.
 *
 * Every refusal answers HTTP through `domainErrorToHttp`
 * (./domain-errors.ts), the one mapping every lifecycle and money route
 * shares.
 */
export abstract class BankAccountVerificationError extends DomainError {
  abstract override readonly code: BankAccountErrorCode;
}

export { domainErrorToHttp, type BankAccountErrorCode } from "./domain-errors";

/** A required field is missing or malformed; `field` names it. */
export class InvalidBankAccountError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_INVALID";
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "InvalidBankAccountError";
  }
}

/**
 * No BankAccount matches, or it does not belong to the acting person. The
 * two are answered alike (404, never 403) so a route never tells a caller
 * whose account an id belongs to.
 */
export class BankAccountNotFoundError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_NOT_FOUND";
  constructor() {
    super("Bank Account tidak ditemukan.");
    this.name = "BankAccountNotFoundError";
  }
}

/**
 * Decision 1's "checked once" (ticket 16): the account already has a
 * `verifiedAt` and may not be submitted again.
 */
export class BankAccountAlreadyVerifiedError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_ALREADY_VERIFIED";
  constructor() {
    super("Bank Account ini sudah terverifikasi.");
    this.name = "BankAccountAlreadyVerifiedError";
  }
}

/** At most one PENDING BankAccountVerificationRequest per account. */
export class BankAccountVerificationAlreadyPendingError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_VERIFICATION_ALREADY_PENDING";
  constructor() {
    super("Masih ada pengajuan verifikasi yang menunggu keputusan Verifier untuk Bank Account ini.");
    this.name = "BankAccountVerificationAlreadyPendingError";
  }
}

/**
 * Decision 5: an account may be deleted only when `verifiedAt` is null AND
 * it has no BankAccountVerificationRequest row of any outcome -- not only
 * "no PENDING one". A REJECTED or WITHDRAWN row blocks the delete exactly as
 * a PENDING one does, because it is a record of a Verifier's look, and
 * records are not deleted.
 */
export class BankAccountNotDeletableError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_NOT_DELETABLE";
  constructor() {
    super(
      "Bank Account ini tidak dapat dihapus: sudah terverifikasi, atau sudah pernah diajukan untuk diverifikasi."
    );
    this.name = "BankAccountNotDeletableError";
  }
}

export class BankAccountVerificationRequestNotFoundError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_VERIFICATION_REQUEST_NOT_FOUND";
  constructor() {
    super("Pengajuan verifikasi Bank Account tidak ditemukan.");
    this.name = "BankAccountVerificationRequestNotFoundError";
  }
}

/**
 * The request is no longer PENDING: it was already decided or withdrawn,
 * possibly by a concurrent request that committed first -- the same
 * conditional-write race `closeRequest` (campaign-lifecycle.ts) guards
 * against, reused here rather than a `FOR UPDATE` on BankAccount (ADR 0018;
 * ticket 16 refuses one deliberately, since a bank account is not a ledger
 * subject).
 */
export class BankAccountVerificationNotPendingError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_VERIFICATION_NOT_PENDING";
  constructor() {
    super("Pengajuan verifikasi ini sudah tidak berstatus menunggu.");
    this.name = "BankAccountVerificationNotPendingError";
  }
}

/**
 * A Verifier's decision is missing what decision 2 requires: both
 * `checkedBankCode` and `documentedAccountName` to approve, or a reason to
 * reject. `field` names the missing one.
 */
export class BankAccountDecisionInvalidError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_DECISION_INVALID";
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "BankAccountDecisionInvalidError";
  }
}

/**
 * A Verifier tried to decide a BankAccountVerificationRequest on their own
 * account (ADR 0018), the same shape as OwnSubjectConflictError for a
 * Campaign or Volunteer Trip.
 */
export class OwnBankAccountVerificationError extends BankAccountVerificationError {
  readonly code = "OWN_BANK_ACCOUNT_CONFLICT";
  constructor() {
    super(
      "Anda tidak dapat memutuskan verifikasi Bank Account milik Anda sendiri. Tindakan ini harus dilakukan Verifier lain."
    );
    this.name = "OwnBankAccountVerificationError";
  }
}

/**
 * Ticket 11: the account is not currently eligible (`verifiedAt` is
 * already null), whether it was never verified or is already revoked, so
 * there is nothing for a revoke to clear.
 */
export class BankAccountNotRevocableError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_NOT_REVOCABLE";
  constructor() {
    super("Bank Account ini belum terverifikasi, jadi tidak ada yang bisa dicabut.");
    this.name = "BankAccountNotRevocableError";
  }
}

/**
 * Ticket 11: the account's latest revoke/reinstate row is not a REVOKED one
 * (never revoked, or already reinstated), so there is nothing to restore.
 */
export class BankAccountNotReinstatableError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_NOT_REINSTATABLE";
  constructor() {
    super("Bank Account ini tidak sedang dicabut, jadi tidak ada yang bisa dipulihkan.");
    this.name = "BankAccountNotReinstatableError";
  }
}

/**
 * Ticket 11, owner decision (b): the Verifier who most recently approved
 * this account's verification may not be the one who revokes it -- the same
 * two-pairs-of-eyes reasoning as ticket 16's "Verifier tak menilai
 * rekeningnya sendiri", applied to the person who already vouched for it
 * once.
 */
export class RevokerWasApproverError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_REVOKED_BY_APPROVER";
  constructor() {
    super(
      "Verifier yang meloloskan verifikasi Bank Account ini tidak dapat mencabutnya sendiri. Tindakan ini harus dilakukan Verifier lain."
    );
    this.name = "RevokerWasApproverError";
  }
}

/**
 * Ticket 11, owner decision (b): a different Verifier than the one who
 * revoked the account must be the one who reinstates it.
 */
export class ReinstaterWasRevokerError extends BankAccountVerificationError {
  readonly code = "BANK_ACCOUNT_REINSTATED_BY_REVOKER";
  constructor() {
    super(
      "Verifier yang mencabut verifikasi Bank Account ini tidak dapat memulihkannya sendiri. Tindakan ini harus dilakukan Verifier lain."
    );
    this.name = "ReinstaterWasRevokerError";
  }
}
