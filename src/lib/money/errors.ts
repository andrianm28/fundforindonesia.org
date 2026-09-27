import { DomainError, type MoneyErrorCode } from '@/lib/domain-errors';

/**
 * The money layer's typed refusals, for Payouts and Refunds on both a
 * Campaign and a Volunteer Trip. Each carries a stable `code` and an
 * Indonesian `message` for the person who acted, and answers HTTP through
 * `domainErrorToHttp` (src/lib/domain-errors.ts), the same mapping the
 * lifecycle routes use. ./payouts.ts and ./refunds.ts re-export the ones
 * they raise, so `catch` sites that import from there keep working.
 *
 * Acting as Admin on your own Campaign or Trip is refused by the Capacity
 * judgement's OwnSubjectConflictError (src/lib/capacity.ts), not a money
 * error.
 */
export abstract class MoneyError extends DomainError {
  abstract override readonly code: MoneyErrorCode;
}

/**
 * The Campaign is a Demo Campaign (CONTEXT.md): sample content with no real
 * ledger balance behind it. Refused by name, not as an insufficient
 * balance, so an operator does not go hunting for money that never existed.
 */
export class DemoCampaignError extends MoneyError {
  readonly code = 'DEMO_CAMPAIGN';
  constructor() {
    super('Demo Campaign tidak memiliki dana nyata untuk Payout atau Refund.');
    this.name = 'DemoCampaignError';
  }
}

/**
 * The Bank Account does not exist, is not the requester's, or has no
 * verifiedAt. A Payout destination must be both owned and verified: either
 * gap alone would let money go to a stranger. Re-checked at approval,
 * because verification can be revoked between request and approval.
 */
export class BankAccountNotEligibleError extends MoneyError {
  readonly code = 'BANK_ACCOUNT_NOT_ELIGIBLE';
  constructor() {
    super('Bank Account tujuan tidak ditemukan, bukan milik pengaju, atau belum terverifikasi.');
    this.name = 'BankAccountNotEligibleError';
  }
}

/**
 * The Payout exceeds the withdrawable balance (Campaign Balance or
 * TRIP_BALANCE), always derived from the ledger, never from
 * Campaign.collectedAmount.
 */
export class InsufficientBalanceError extends MoneyError {
  readonly code = 'INSUFFICIENT_BALANCE';
  constructor(
    readonly requested: number,
    readonly available: number,
  ) {
    super('Jumlah Payout melebihi Campaign Balance atau saldo Volunteer Trip yang tersedia.');
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * The two-person rule: the approver is the requester. Refused before any
 * write, not recorded as a decision. One class for Payout, Refund and
 * Manual Contribution.
 */
export class SelfApprovalError extends MoneyError {
  readonly code = 'SELF_APPROVAL';
  constructor(readonly what: 'Payout' | 'Refund' | 'Manual Contribution') {
    super(`${what} tidak dapat disetujui oleh orang yang mengajukannya.`);
    this.name = 'SelfApprovalError';
  }
}

/** The Payout is no longer DRAFT, or another approval won the race. */
export class InvalidPayoutStatusError extends MoneyError {
  readonly code = 'INVALID_PAYOUT_STATUS';
  constructor(
    readonly currentStatus: string,
    readonly detail?: string,
  ) {
    super('Payout tidak lagi menunggu persetujuan.');
    this.name = 'InvalidPayoutStatusError';
  }
}

/** The Refund is no longer REQUESTED, or another approval won the race. */
export class InvalidRefundStatusError extends MoneyError {
  readonly code = 'INVALID_REFUND_STATUS';
  constructor(
    readonly currentStatus: string,
    readonly detail?: string,
  ) {
    super('Refund tidak lagi menunggu persetujuan.');
    this.name = 'InvalidRefundStatusError';
  }
}

export class PayoutNotFoundError extends MoneyError {
  readonly code = 'PAYOUT_NOT_FOUND';
  constructor(readonly payoutId: string) {
    super('Payout tidak ditemukan.');
    this.name = 'PayoutNotFoundError';
  }
}

export class RefundNotFoundError extends MoneyError {
  readonly code = 'REFUND_NOT_FOUND';
  constructor(readonly refundId: string) {
    super('Refund tidak ditemukan.');
    this.name = 'RefundNotFoundError';
  }
}

export class PaymentNotFoundError extends MoneyError {
  readonly code = 'PAYMENT_NOT_FOUND';
  constructor(readonly paymentId: string) {
    super('Payment tidak ditemukan.');
    this.name = 'PaymentNotFoundError';
  }
}

/**
 * The Payment belongs to another subject: a Campaign-linked Payment refunded
 * against a Trip, a Trip-linked one against a Campaign, or the wrong
 * Campaign or Trip entirely. Answers 404 like a Payment that does not
 * exist, with its own code.
 */
export class PaymentSubjectMismatchError extends MoneyError {
  readonly code = 'PAYMENT_SUBJECT_MISMATCH';
  constructor(readonly paymentId: string) {
    super('Payment tidak ditemukan untuk Campaign atau Volunteer Trip ini.');
    this.name = 'PaymentSubjectMismatchError';
  }
}

/**
 * The Refund exceeds what is still refundable on the Payment: its Gross
 * minus every prior Refund that is not REJECTED or FAILED (REQUESTED ones
 * count too, since their funds are already frozen).
 */
export class RefundExceedsRemainingError extends MoneyError {
  readonly code = 'REFUND_EXCEEDS_REMAINING';
  constructor(
    readonly requested: number,
    readonly remaining: number,
  ) {
    super('Jumlah Refund melebihi sisa yang masih bisa direfund dari Payment ini.');
    this.name = 'RefundExceedsRemainingError';
  }
}

/**
 * The Manual Contribution (CONTEXT.md) names no target, or names two at once.
 * A Manual Contribution credits exactly one balance, and "both" is not a way
 * to be in two balances at the same time.
 */
export class ManualContributionTargetError extends MoneyError {
  readonly code = 'MANUAL_CONTRIBUTION_TARGET_INVALID';
  constructor(
    message = 'Manual Contribution harus menunjuk tepat satu Campaign atau satu Program.',
  ) {
    super(message);
    this.name = 'ManualContributionTargetError';
  }
}

/**
 * No proof of transfer. Required rather than optional because the entire point
 * of a Manual Contribution is that no provider confirms it: the evidence is
 * the only thing standing between a recorded number and a fabricated one, and
 * the two-person rule only ever checks that evidence.
 */
export class ManualContributionProofRequiredError extends MoneyError {
  readonly code = 'MANUAL_CONTRIBUTION_PROOF_REQUIRED';
  constructor() {
    super('Bukti transfer wajib diisi untuk setiap Manual Contribution.');
    this.name = 'ManualContributionProofRequiredError';
  }
}

/** Not whole rupiah, or not above zero -- the two ways a money amount is wrong here. */
export class ManualContributionAmountError extends MoneyError {
  readonly code = 'MANUAL_CONTRIBUTION_AMOUNT_INVALID';
  constructor() {
    super('Nominal Manual Contribution harus berupa angka rupiah bulat di atas nol.');
    this.name = 'ManualContributionAmountError';
  }
}

export class ManualContributionNotFoundError extends MoneyError {
  readonly code = 'MANUAL_CONTRIBUTION_NOT_FOUND';
  constructor(readonly manualContributionId: string) {
    super('Manual Contribution tidak ditemukan.');
    this.name = 'ManualContributionNotFoundError';
  }
}

/** The contribution is no longer PENDING, or another decision won the race. */
export class ManualContributionNotPendingError extends MoneyError {
  readonly code = 'MANUAL_CONTRIBUTION_NOT_PENDING';
  constructor(
    readonly currentStatus: string,
    readonly detail?: string,
  ) {
    super('Manual Contribution ini tidak lagi menunggu keputusan Admin kedua.');
    this.name = 'ManualContributionNotPendingError';
  }
}

/**
 * The contribution was never APPROVED, or has already been reversed. Nothing
 * entered the books, so there is nothing to take back out of them.
 */
export class ManualContributionNotApprovedError extends MoneyError {
  readonly code = 'MANUAL_CONTRIBUTION_NOT_APPROVED';
  constructor(readonly currentStatus: string) {
    super('Hanya Manual Contribution yang sudah disetujui yang bisa dibalikkan.');
    this.name = 'ManualContributionNotApprovedError';
  }
}

/**
 * The balance no longer covers the contribution: a Payout has drawn the money
 * out, or a Refund has frozen it. The opposite journal would drive the pool
 * negative, so the money is left where it is and a human decides what to do
 * about it -- the reporting surfaces it, nothing here silently corrects it.
 */
export class ManualContributionAlreadySpentError extends MoneyError {
  readonly code = 'MANUAL_CONTRIBUTION_ALREADY_SPENT';
  constructor(
    readonly amount: number,
    readonly available: number,
  ) {
    super(
      'Dana Manual Contribution ini sudah tidak ada di saldo, jadi tidak bisa dibalikkan. ' +
        'Saldo yang tersedia lebih kecil daripada nominalnya.',
    );
    this.name = 'ManualContributionAlreadySpentError';
  }
}
