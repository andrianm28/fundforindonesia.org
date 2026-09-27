import { DomainError, type MoneyErrorCode } from '@/lib/domain-errors';
import type { Kind } from '@/generated/prisma/client';
import { KIND_LABEL } from '@/lib/campaign-kind';

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
 *
 * One error for all three paths that can touch a Demo Campaign's money -- a
 * Payout, a Refund, and a Manual Contribution -- because it is one rule: real
 * rupiah never enters a Campaign whose data is fictional. A contribution
 * credited to one would be money nobody could ever get out again, since
 * neither of the other two paths would move it.
 */
export class DemoCampaignError extends MoneyError {
  readonly code = 'DEMO_CAMPAIGN';
  constructor() {
    super('Demo Campaign tidak memiliki dana nyata untuk Payout, Refund, atau Manual Contribution.');
    this.name = 'DemoCampaignError';
  }
}

/**
 * The Bank Account does not exist, is not the requester's, or has no
 * verifiedAt. A Payout destination must be both owned and verified: either
 * gap alone would let money go to a stranger. Re-checked at every step after
 * the request -- approval, and completion -- because verification can be
 * revoked, and the window does not close at approval: nothing has been sent
 * until a second Admin records the transfer. One error for all three, so the
 * three gates cannot disagree about what an eligible destination is.
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
 *
 * `action` names which half of the rule was breached, because the rule does
 * not stop at approval: a Manual Contribution can also be reversed, and the
 * two people who put the money in -- the one who recorded it and the one who
 * approved it -- may not be the one who takes it back out. The CODE is the
 * same either way (one rule, one code, one HTTP status); only the sentence
 * differs, so an Admin refused on a reversal is not told they may not approve
 * something they never approved.
 */
export class SelfApprovalError extends MoneyError {
  readonly code = 'SELF_APPROVAL';
  constructor(
    readonly what: 'Payout' | 'Refund' | 'Manual Contribution',
    readonly action: 'approval' | 'reversal' = 'approval',
  ) {
    super(
      action === 'reversal'
        ? `${what} tidak dapat dibalikkan oleh orang yang mencatat atau menyetujuinya.`
        : `${what} tidak dapat disetujui oleh orang yang mengajukannya.`,
    );
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
 * A Refund on a zakat, Wakaf or Hibah Campaign for anything but a technical
 * failure (PRD §196; ADR 0013): a fulfilled zakat obligation and a sworn waqf
 * pledge do not return to the giver, so an ordinary "I changed my mind" must
 * not become money out of the pool.
 *
 * It is refused by the Campaign's Kind, which is a fact about the Campaign and
 * not about who asked, and the Admin cannot clear it by resending -- the only
 * thing that would satisfy it is claiming one of the named failures. So it
 * answers 403 with the other policy refusals (DEMO_CAMPAIGN, SELF_APPROVAL),
 * not with the 4xx the fixable-input refusals use.
 *
 * `allowedReasons` names the failures that would pass, so the person refused
 * is told what would be accepted rather than only what is not.
 */
export class RefundNotAllowedForKindError extends MoneyError {
  readonly code = 'REFUND_NOT_ALLOWED_FOR_KIND';
  constructor(
    readonly campaignKind: Kind,
    readonly allowedReasons: readonly string[],
  ) {
    super(
      `Refund pada Campaign ber-Kind ${KIND_LABEL[campaignKind]} hanya sah untuk kegagalan teknis: ${allowedReasons.join(', ')}.`,
    );
    this.name = 'RefundNotAllowedForKindError';
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
 * Some other field of the record is unusable: a note or a reason left blank,
 * or longer than the column takes. Its own code rather than a reuse of the
 * target's, so a client that sent a mistyped note is not told the target is
 * wrong.
 */
export class ManualContributionInputError extends MoneyError {
  readonly code = 'MANUAL_CONTRIBUTION_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ManualContributionInputError';
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

/**
 * Not whole rupiah, not above zero, or past what the column can hold -- the
 * ways a money amount is wrong here. The last one is the column's own limit
 * (ManualContribution.amount is an Int), not a rule of our own: refused only
 * by the database it would be a driver error, which no route can turn into a
 * 400.
 */
export class ManualContributionAmountError extends MoneyError {
  readonly code = 'MANUAL_CONTRIBUTION_AMOUNT_INVALID';
  constructor() {
    super('Nominal Manual Contribution harus berupa angka rupiah bulat di atas nol dan tidak melebihi 2.147.483.647.');
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

/**
 * The sweep from a Payment Provider to the Collection Account
 * (prd-compliance 35; PRD FFI-07; ADR 0011) carries one field with nothing
 * else to check it against, because no provider this platform talks to exposes
 * a balance API: the figure an Admin read in the provider's dashboard.
 *
 * So the two refusals below are about whether that figure was written down and
 * whether it covers the money about to move. Neither of them decides whether the
 * reading is TRUE -- nothing here can, and nothing pretends to. They make the
 * reading exist, which is the whole of what FFI-07 asks the system to do.
 */

/** An approval arrived with no provider balance recorded against it. */
export class ProviderBalanceNotRecordedError extends MoneyError {
  readonly code = 'PROVIDER_BALANCE_NOT_RECORDED';
  constructor() {
    super(
      'Saldo penyedia pembayaran belum dicatat. Buka dashboard penyedia, catat saldo yang terlihat ' +
        'dan nama penyedia-nya, baru setujui Payout ini -- tanpa catatan itu sistem tidak bisa ' +
        'memastikan uangnya benar-benar ada.',
    );
    this.name = 'ProviderBalanceNotRecordedError';
  }
}

/**
 * The recorded provider balance is short of the Payout's own amount.
 *
 * The point of FFI-07: approving against a Campaign Balance says the Campaign is
 * owed money, and says nothing about whether the provider is holding it. This
 * is the check that the money is there, and it is the only one that can be
 * made -- the reading is a human's, taken by hand, from a dashboard.
 */
export class ProviderBalanceInsufficientError extends MoneyError {
  readonly code = 'PROVIDER_BALANCE_INSUFFICIENT';
  constructor(
    readonly payoutAmount: number,
    readonly providerBalance: number,
    readonly provider: string,
  ) {
    super(
      `Saldo yang tercatat di ${provider} adalah ${providerBalance}, lebih kecil daripada nominal Payout ${payoutAmount}. ` +
        'Payout ini belum disetujui: cek ulang dashboard penyedia, atau tunggu sampai saldonya cukup.',
    );
    this.name = 'ProviderBalanceInsufficientError';
  }
}

/** A field of a recorded Provider Withdrawal is empty, of the wrong type, or too long. */
export class ProviderWithdrawalInputError extends MoneyError {
  readonly code = 'PROVIDER_WITHDRAWAL_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ProviderWithdrawalInputError';
  }
}

/**
 * A Provider Withdrawal amount or a dashboard reading is not whole rupiah, or
 * not within what the columns can hold. A reading may be zero -- an empty
 * provider balance is a real reading -- but never negative: a negative
 * "balance" describes nothing and would reconcile against a pot as though the
 * provider owed the platform money.
 */
export class ProviderWithdrawalAmountError extends MoneyError {
  readonly code = 'PROVIDER_WITHDRAWAL_AMOUNT_INVALID';
  constructor(
    readonly field: string,
    readonly rule: 'positive' | 'nonNegative',
  ) {
    super(
      rule === 'positive'
        ? `Nominal penarikan harus berupa angka rupiah bulat di atas nol dan tidak melebihi 2.147.483.647. Field: ${field}.`
        : `Saldo penyedia (${field}) harus berupa angka rupiah bulat nol atau lebih besar dan tidak melebihi 2.147.483.647.`,
    );
    this.name = 'ProviderWithdrawalAmountError';
  }
}

/** A withdrawal of the platform's own money with nothing standing behind it. */
export class ProviderWithdrawalProofRequiredError extends MoneyError {
  readonly code = 'PROVIDER_WITHDRAWAL_PROOF_REQUIRED';
  constructor() {
    super('Bukti penarikan wajib diisi untuk setiap penarikan dari penyedia pembayaran.');
    this.name = 'ProviderWithdrawalProofRequiredError';
  }
}

/**
 * The provider's own reference for this disbursement is already recorded.
 *
 * Distinct from a write failure, and it has to be: "this sweep is already on
 * the books" needs no retry and no alert, while "the write failed" does. The
 * unique index on ProviderWithdrawal.reference is what decides it, not a read
 * first -- two admins recording the same dashboard entry at the same moment
 * would both read "absent" and both write, and the second one to reach the
 * database would take the money out of the Provider Balance a second time.
 */
export class ProviderWithdrawalDuplicateError extends MoneyError {
  readonly code = 'PROVIDER_WITHDRAWAL_DUPLICATE';
  constructor(readonly reference: string) {
    super(
      `Penarikan dengan referensi ${reference} dari penyedia sudah tercatat. ` +
        'Referensi itu diberikan satu kali per penarikan, jadi mencatatnya lagi berarti uang yang sama diklaim dua kali.',
    );
    this.name = 'ProviderWithdrawalDuplicateError';
  }
}

/** The named Collecting Entity is not registered, so the row would name nothing. */
export class ProviderWithdrawalNotFoundError extends MoneyError {
  readonly code = 'PROVIDER_WITHDRAWAL_ENTITY_NOT_FOUND';
  constructor(readonly collectingEntityId: string) {
    super('Collecting Entity yang dituju tidak terdaftar.');
    this.name = 'ProviderWithdrawalNotFoundError';
  }
}
