import type { RefundStatus } from '@/generated/prisma/client';

/**
 * The one name for each Refund Status, following the same total-Record
 * shape PAYOUT_STATUS_LABEL already uses for Payout (./payout-status-label.ts)
 * and for the same reason: a raw English enum value should never reach an
 * Admin's screen, and being total over `RefundStatus` means a status added
 * to the enum cannot compile without someone deciding what to call it here.
 *
 * REQUESTED, APPROVED, COMPLETED, REJECTED AND FAILED ARE WRITTEN (ticket
 * 23's REQUESTED→APPROVED, ticket 31's APPROVED→COMPLETED with proof of
 * transfer, ticket 49's rejectRefund and failRefund, whose buttons ticket 50
 * adds). AwaitingDonorDetails and Processing stay in the schema's
 * `RefundStatus` for a later rilis and are labelled here as what they are --
 * stages this repo has not built -- rather than rendered as if a row could
 * actually carry one today.
 */
export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  REQUESTED: 'Menunggu persetujuan Admin lain',
  APPROVED: 'Disetujui, menunggu penyelesaian',
  AWAITING_DONOR_DETAILS: 'Menunggu detail Donor (belum dibangun)',
  PROCESSING: 'Sedang diproses (belum dibangun)',
  COMPLETED: 'Selesai',
  REJECTED: 'Ditolak',
  FAILED: 'Gagal',
};
