import { describe, it, expect } from 'vitest';
import { domainErrorToHttp } from './domain-errors';
import {
  BankAccountNotEligibleError,
  DemoCampaignError,
  InsufficientBalanceError,
  InvalidPayoutStatusError,
  PayoutNotFoundError,
  SelfApprovalError,
} from './money/payouts';
import {
  InvalidRefundStatusError,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundAfterCampaignTransferError,
  RefundExceedsRemainingError,
  RefundNotFoundError,
} from './money/refunds';
import { OwnSubjectConflictError } from './capacity';

describe('domainErrorToHttp for the money refusals', () => {
  // Statuses are the ones the Payout and Refund routes answered before the
  // money errors carried codes.
  it.each([
    [new DemoCampaignError(), 403, 'DEMO_CAMPAIGN'],
    [new BankAccountNotEligibleError(), 403, 'BANK_ACCOUNT_NOT_ELIGIBLE'],
    [new InsufficientBalanceError(100, 40), 400, 'INSUFFICIENT_BALANCE'],
    [new SelfApprovalError('Payout'), 403, 'SELF_APPROVAL'],
    [new SelfApprovalError('Refund'), 403, 'SELF_APPROVAL'],
    [new InvalidPayoutStatusError('COMPLETED'), 409, 'INVALID_PAYOUT_STATUS'],
    [new InvalidRefundStatusError('APPROVED'), 409, 'INVALID_REFUND_STATUS'],
    [new PayoutNotFoundError('p1'), 404, 'PAYOUT_NOT_FOUND'],
    [new RefundNotFoundError('r1'), 404, 'REFUND_NOT_FOUND'],
    [new PaymentNotFoundError('pay1'), 404, 'PAYMENT_NOT_FOUND'],
    [new PaymentSubjectMismatchError('pay1'), 404, 'PAYMENT_SUBJECT_MISMATCH'],
    [new RefundExceedsRemainingError(20_000, 10_000), 400, 'REFUND_EXCEEDS_REMAINING'],
    [new RefundAfterCampaignTransferError(20_000, 0), 409, 'REFUND_AFTER_CAMPAIGN_TRANSFER'],
    [new OwnSubjectConflictError('trip', 'ADMIN'), 403, 'OWN_TRIP_CONFLICT'],
    [new OwnSubjectConflictError('campaign', 'ADMIN'), 403, 'OWN_CAMPAIGN_CONFLICT'],
  ])('%s answers %i with code %s and its Indonesian message', (error, status, code) => {
    expect(domainErrorToHttp(error)).toEqual({ status, body: { error: error.message, code } });
  });

  it('words the own-Trip conflict for the capacity', () => {
    expect(new OwnSubjectConflictError('trip', 'ADMIN').message).toBe(
      'Anda tidak dapat bertindak sebagai Admin atas Volunteer Trip milik Anda sendiri. Tindakan ini harus dilakukan Admin lain.',
    );
    expect(new OwnSubjectConflictError('trip', 'VERIFIER').message).toBe(
      'Anda tidak dapat bertindak sebagai Verifier atas Volunteer Trip milik Anda sendiri. Tindakan ini harus dilakukan Verifier lain.',
    );
  });

  it('names who may not approve in the self-approval message', () => {
    expect(new SelfApprovalError('Payout').message).toBe(
      'Payout tidak dapat disetujui oleh orang yang mengajukannya.',
    );
    expect(new SelfApprovalError('Refund').message).toBe(
      'Refund tidak dapat disetujui oleh orang yang mengajukannya.',
    );
  });

  it('keeps one self-approval class for Payouts and Refunds', async () => {
    const payouts = await import('./money/payouts');
    const refunds = await import('./money/refunds');
    expect(payouts.SelfApprovalError).toBe(refunds.SelfApprovalError);
  });

  it('returns null for an error that is not a typed refusal', () => {
    expect(domainErrorToHttp(new Error('database down'))).toBeNull();
  });
});
