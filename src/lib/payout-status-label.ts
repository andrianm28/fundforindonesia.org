import type { PayoutStatus } from '@/generated/prisma/client';

/**
 * The one name for each Payout Status, in the words the person waiting for
 * their money would use (CONTEXT.md, Payout).
 *
 * NOT `STATUS_LABEL`. That name already means the Campaign lifecycle's status
 * names, everywhere in this repo (./campaign-status-label.ts, re-exported by
 * ./campaign-lifecycle-errors.ts and used by ./subject-guard.ts and
 * ./campaign-lifecycle.ts). Two different lifecycles wearing one name is how
 * a reader of either file ends up looking up the wrong vocabulary, so this
 * carries its own subject, exactly as INQUIRY_STATUS_LABEL does for a
 * Partnership Inquiry (./partnership-inquiry-status.ts).
 *
 * TOTAL, not Partial. A Payout's own column is the only thing that can end up
 * in a Fundraiser's payout history, and a `Partial` map with a `?? status`
 * fallback is how a raw English enum reaches a person reading their own money:
 * a status this repo does not write yet still has to have words. Being
 * exhaustive also means a status added to the enum cannot compile without
 * someone deciding what to call it here, which is the moment to decide.
 *
 * DRAFT is what a request is the moment it is made and stays until an Admin
 * approves it -- there is no separate "submitted" state in this codebase
 * (./money/payouts.ts) -- so it is labelled as what it is actually waiting
 * for. SUBMITTED, REJECTED, PROCESSING and FAILED are in the schema for
 * stages this repo has not built; they are given plain words rather than
 * rendered as if they could occur, so a row that somehow carries one is
 * described instead of leaked.
 */
export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  DRAFT: 'Menunggu persetujuan Admin',
  SUBMITTED: 'Diajukan, menunggu ditinjau',
  APPROVED: 'Disetujui, menunggu dana dikirim',
  REJECTED: 'Ditolak',
  PROCESSING: 'Sedang dikirim',
  COMPLETED: 'Selesai',
  FAILED: 'Gagal',
};
