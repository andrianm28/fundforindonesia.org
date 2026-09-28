import { describe, it, expect } from 'vitest';
import { REFUND_STATUS_LABEL } from './refund-status-label';

describe('REFUND_STATUS_LABEL', () => {
  it('names the two statuses Rilis 1 actually produces', () => {
    expect(REFUND_STATUS_LABEL.REQUESTED).toBe('Menunggu persetujuan Admin lain');
    expect(REFUND_STATUS_LABEL.APPROVED).toBe('Disetujui');
  });

  it('is total over RefundStatus, so a status this repo has not built yet still has words', () => {
    expect(REFUND_STATUS_LABEL.AWAITING_DONOR_DETAILS).toBeTypeOf('string');
    expect(REFUND_STATUS_LABEL.PROCESSING).toBeTypeOf('string');
    expect(REFUND_STATUS_LABEL.COMPLETED).toBeTypeOf('string');
    expect(REFUND_STATUS_LABEL.REJECTED).toBeTypeOf('string');
    expect(REFUND_STATUS_LABEL.FAILED).toBeTypeOf('string');
  });
});
