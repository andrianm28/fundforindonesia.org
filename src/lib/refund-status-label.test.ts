import { describe, it, expect } from 'vitest';
import { REFUND_STATUS_LABEL } from './refund-status-label';

describe('REFUND_STATUS_LABEL', () => {
  it('names the three statuses ticket 23 and ticket 31 actually produce', () => {
    expect(REFUND_STATUS_LABEL.REQUESTED).toBe('Menunggu persetujuan Admin lain');
    expect(REFUND_STATUS_LABEL.APPROVED).toBe('Disetujui, menunggu penyelesaian');
    expect(REFUND_STATUS_LABEL.COMPLETED).toBe('Selesai');
  });

  it('names Rejected and Failed as what a Refund really reaches (tickets 49 and 50), not as unbuilt', () => {
    expect(REFUND_STATUS_LABEL.REJECTED).toBe('Ditolak');
    expect(REFUND_STATUS_LABEL.FAILED).toBe('Gagal');
  });

  it('is total over RefundStatus, so a status this repo has not built yet still has words', () => {
    expect(REFUND_STATUS_LABEL.AWAITING_DONOR_DETAILS).toBeTypeOf('string');
    expect(REFUND_STATUS_LABEL.PROCESSING).toBeTypeOf('string');
    expect(REFUND_STATUS_LABEL.REJECTED).toBeTypeOf('string');
    expect(REFUND_STATUS_LABEL.FAILED).toBeTypeOf('string');
  });
});
