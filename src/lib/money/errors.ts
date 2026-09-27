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
 * write, not recorded as a decision. One class for Payout and Refund.
 */
export class SelfApprovalError extends MoneyError {
  readonly code = 'SELF_APPROVAL';
  constructor(readonly what: 'Payout' | 'Refund') {
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

/**
 * A Payout completion with no proof of transfer attached (CONTEXT.md, Payout:
 * "ditandai selesai dengan bukti transfer"; ADR 0006, where the mandatory
 * proof is named as one of the two controls the two-person rule rests on).
 *
 * Refused rather than warned because a COMPLETED row with no proof is a
 * claim that the money moved, not a record that it did -- and because the
 * money has, by then, left the platform: nothing here can be checked
 * afterwards from the books, only from the image an Admin was asked for
 * and did not attach.
 */
export class PayoutProofRequiredError extends MoneyError {
  readonly code = 'PAYOUT_PROOF_REQUIRED';
  constructor() {
    super('Payout hanya dapat ditandai selesai dengan bukti transfer yang terlampir.');
    this.name = 'PayoutProofRequiredError';
  }
}

/**
 * The two-person rule on the SECOND action: the Admin recording the transfer
 * is the Admin who approved it (or the Payout has no recorded approver at
 * all, which cannot show two people either). Distinct from SelfApprovalError,
 * which is the same rule on the first action -- the requester approving
 * their own request.
 *
 * ContEXT.md, Payout: the Payout is "disetujui satu Admin, lalu ... ditandai
 * selesai dengan bukti transfer oleh Admin yang berbeda". The rule is
 * enforced here, not merely advised: an approver who marks their own
 * approval done has performed one person's action and called it two, and
 * nothing downstream of that write can tell the difference.
 */
export class TwoPersonRuleError extends MoneyError {
  readonly code = 'TWO_PERSON_RULE';
  constructor() {
    super(
      'Payout harus disetujui oleh Admin yang tercatat dan diselesaikan oleh Admin yang berbeda darinya (aturan dua orang).',
    );
    this.name = 'TwoPersonRuleError';
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
