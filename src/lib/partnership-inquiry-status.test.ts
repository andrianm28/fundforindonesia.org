import { describe, expect, it } from 'vitest';
import {
  BUDGET_RANGE_LABEL,
  INITIAL_INQUIRY_STATUS,
  INQUIRY_STATUS_LABEL,
  PARTNERSHIP_BUDGET_RANGES,
  PARTNERSHIP_INQUIRY_STATUSES,
  inquiryTransitionNeedsReason,
  isBudgetRange,
  isInquiryStatus,
} from './partnership-inquiry-status';

/**
 * pks-pemenuhan/17 (PKS Pasal 3.6): the pipeline has eight stages, in this
 * order, with these Indonesian labels; a new Inquiry starts at Baru.
 */
describe('partnership inquiry pipeline vocabulary', () => {
  it('has the eight stages of Pasal 3.6, in pipeline order, labelled in Indonesian', () => {
    expect(PARTNERSHIP_INQUIRY_STATUSES.map((s) => INQUIRY_STATUS_LABEL[s])).toEqual([
      'Baru',
      'Dihubungi',
      'Proposal',
      'Negosiasi',
      'Disetujui',
      'Berjalan',
      'Selesai',
      'Tidak dilanjutkan',
    ]);
    expect(INITIAL_INQUIRY_STATUS).toBe('NEW');
  });

  it('knows a status only by its code, and the old codes are gone', () => {
    expect(isInquiryStatus('NEGOTIATION')).toBe(true);
    expect(isInquiryStatus('NOT_YET_FOLLOWED_UP')).toBe(false);
    expect(isInquiryStatus('IN_PROGRESS')).toBe(false);
    expect(isInquiryStatus(undefined)).toBe(false);
  });

  it('lets an Inquiry move freely, except out of a closed stage, which needs a reason', () => {
    expect(inquiryTransitionNeedsReason('NEW', 'APPROVED')).toBe(false);
    expect(inquiryTransitionNeedsReason('APPROVED', 'CONTACTED')).toBe(false);
    expect(inquiryTransitionNeedsReason('DONE', 'ONGOING')).toBe(true);
    expect(inquiryTransitionNeedsReason('DROPPED', 'NEW')).toBe(true);
    // Staying where it is is not leaving.
    expect(inquiryTransitionNeedsReason('DONE', 'DONE')).toBe(false);
  });

  it('offers four budget ranges, labelled', () => {
    expect(PARTNERSHIP_BUDGET_RANGES).toHaveLength(4);
    expect(isBudgetRange('OVER_1B')).toBe(true);
    expect(isBudgetRange('1000')).toBe(false);
    expect(BUDGET_RANGE_LABEL.UNDER_50M).toBe('Di bawah Rp50 juta');
  });
});
