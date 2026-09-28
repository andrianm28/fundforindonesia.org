import { DomainError, type UsageReportErrorCode } from './domain-errors';

/**
 * Typed refusals of a Usage Report (ticket 22; PRD FFI-07a; CONTEXT.md,
 * Usage Report), answered through `domainErrorToHttp` (./domain-errors.ts)
 * the same way the lifecycle and money errors are.
 */
export abstract class UsageReportError extends DomainError {
  abstract override readonly code: UsageReportErrorCode;
}

/**
 * This Campaign has a COMPLETED Payout whose Usage Report is missing or was
 * marked disputed by an Admin, so no further Payout may be requested against
 * it (CONTEXT.md, Usage Report; PRD FFI-07: "Usage Report wajib pada setiap
 * Payout Completed sebelum Payout berikutnya"). Thrown by `requestPayout`
 * (src/lib/money/payouts.ts), never by anything in this file.
 */
export class UsageReportRequiredError extends UsageReportError {
  readonly code = 'USAGE_REPORT_REQUIRED';
  constructor(readonly blockingPayoutId: string) {
    super(
      'Payout sebelumnya pada Campaign ini belum memiliki Usage Report yang tidak dipertanyakan. Lengkapi dulu sebelum mengajukan Payout berikutnya.',
    );
    this.name = 'UsageReportRequiredError';
  }
}

/** No Usage Report exists with the given id. */
export class UsageReportNotFoundError extends UsageReportError {
  readonly code = 'USAGE_REPORT_NOT_FOUND';
  constructor() {
    super('Usage Report tidak ditemukan.');
    this.name = 'UsageReportNotFoundError';
  }
}

/**
 * The Payout already has a Usage Report: `UsageReport.payoutId` is unique,
 * and this is that constraint's own message, checked before the write so the
 * refusal reads as a rule rather than a database error.
 */
export class UsageReportAlreadyExistsError extends UsageReportError {
  readonly code = 'USAGE_REPORT_ALREADY_EXISTS';
  constructor() {
    super('Payout ini sudah memiliki Usage Report.');
    this.name = 'UsageReportAlreadyExistsError';
  }
}

/**
 * A Usage Report may only be submitted for a COMPLETED Payout: a DRAFT or
 * APPROVED Payout's money has not necessarily moved yet, so there is nothing
 * yet to report on.
 */
export class UsageReportPayoutNotCompletedError extends UsageReportError {
  readonly code = 'USAGE_REPORT_PAYOUT_NOT_COMPLETED';
  constructor() {
    super('Usage Report hanya bisa dikirim untuk Payout yang sudah Completed.');
    this.name = 'UsageReportPayoutNotCompletedError';
  }
}

/**
 * A field the Fundraiser can fix by resending: an empty narrative, fewer
 * than one photo, a line item with no label or a non-positive amount, or a
 * set of line items whose total does not equal the Payout's own amount
 * exactly ("rincian per pos yang jumlahnya sama dengan nominal Payout").
 */
export class UsageReportInvalidError extends UsageReportError {
  readonly code = 'USAGE_REPORT_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'UsageReportInvalidError';
  }
}

/**
 * This Usage Report was already marked dipertanyakan. There is no code path
 * that lifts a dispute once set -- nothing in the spec describes one -- so a
 * second dispute attempt is refused rather than silently overwriting the
 * first Admin's reason.
 */
export class UsageReportAlreadyDisputedError extends UsageReportError {
  readonly code = 'USAGE_REPORT_ALREADY_DISPUTED';
  constructor() {
    super('Usage Report ini sudah ditandai dipertanyakan.');
    this.name = 'UsageReportAlreadyDisputedError';
  }
}
