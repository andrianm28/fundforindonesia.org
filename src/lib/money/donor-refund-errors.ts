import { MoneyError } from './errors';

/**
 * A Donor asked for a Refund while the feature is off: the anti-abuse limits
 * are read from the environment (./donor-refund-config.ts) and at least one
 * required value is unset or invalid. There is no default to fall back on,
 * so the answer is a refusal, not a guess.
 */
export class DonorRefundDisabledError extends MoneyError {
  readonly code = 'DONOR_REFUND_DISABLED';
  constructor() {
    super('Permintaan Refund oleh Donor sedang tidak tersedia. Hubungi tim kami untuk meminta pengembalian dana.');
    this.name = 'DonorRefundDisabledError';
  }
}

/**
 * Why a Donor's own Refund request was refused (CONTEXT.md, Refund; PRD
 * 7.2). One class with a `reason` rather than one per rule: the Donor sees
 * a sentence either way, and no sentence carries a number of the anti-abuse
 * configuration.
 */
export type DonorRefundRefusal =
  | 'NOT_OWNER'
  | 'WINDOW_CLOSED'
  | 'PAYOUT_ALREADY_DREW'
  | 'KIND_NOT_ALLOWED'
  | 'AMOUNT_OVER_LIMIT'
  | 'AMOUNT_INVALID';

const DONOR_REFUND_REFUSAL_MESSAGE: Record<DonorRefundRefusal, string> = {
  NOT_OWNER: 'Donasi tidak ditemukan.',
  WINDOW_CLOSED: 'Batas waktu untuk meminta Refund atas donasi ini sudah lewat. Hubungi tim kami bila ada kendala.',
  PAYOUT_ALREADY_DREW: 'Dana Campaign ini sudah mulai disalurkan, sehingga Refund tidak bisa diminta lewat sini. Hubungi tim kami.',
  KIND_NOT_ALLOWED: 'Jenis Campaign ini tidak menerima permintaan Refund langsung dari Donor. Hubungi tim kami.',
  AMOUNT_OVER_LIMIT: 'Jumlah Refund yang diminta melebihi batas yang berlaku untuk jenis Campaign ini.',
  AMOUNT_INVALID: 'Jumlah Refund harus berupa bilangan bulat rupiah yang lebih dari nol.',
};

export class DonorRefundNotEligibleError extends MoneyError {
  readonly code = 'DONOR_REFUND_NOT_ELIGIBLE';
  constructor(readonly reason: DonorRefundRefusal) {
    super(DONOR_REFUND_REFUSAL_MESSAGE[reason]);
    this.name = 'DonorRefundNotEligibleError';
  }
}

/** The Donor already has as many Refund requests waiting as the limit allows. */
export class DonorRefundTooManyOpenError extends MoneyError {
  readonly code = 'DONOR_REFUND_TOO_MANY_OPEN';
  constructor() {
    super('Anda masih punya permintaan Refund yang belum selesai diproses. Tunggu hingga diputuskan sebelum mengajukan lagi.');
    this.name = 'DonorRefundTooManyOpenError';
  }
}
