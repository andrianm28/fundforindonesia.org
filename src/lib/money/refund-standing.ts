import type { LedgerAccount, LedgerDirection, Prisma, RefundStatus } from '@/generated/prisma/client';
import { refundFreezeTransactionId } from './ledger';
import { RefundFreezeJournalMissingError } from './errors';

/**
 * Whether a Refund still stands (CONTEXT.md, Refund; prd-compliance 54).
 *
 * A Refund stands unless it ended REJECTED or FAILED (ticket 49): those two
 * post their freeze straight back out as the exact mirror, so they took
 * nothing and are out of every Refund figure. Written once, because the
 * sweep, the Impact page, createRefund and the reconciliation all ask it, and
 * tickets 51 and 52 each came from one copy missing a status the others
 * already knew.
 */
const NOT_STANDING_REFUND_STATUSES: RefundStatus[] = ['REJECTED', 'FAILED'];

/** Prisma `where` fragment for the Refunds that still stand. */
export const STANDING_REFUND_WHERE: { status: { notIn: RefundStatus[] } } = {
  status: { notIn: [...NOT_STANDING_REFUND_STATUSES] },
};

export function isRefundStanding(refund: { status: string }): boolean {
  return !(NOT_STANDING_REFUND_STATUSES as string[]).includes(refund.status);
}

export type RefundFreezeEntry = {
  transactionId: string;
  account: LedgerAccount;
  direction: LedgerDirection;
  amount: number;
};

/**
 * The ledger entries of the freeze journals of `refundIds`, for
 * refundFreezeDebit (./ledger.ts) to read. A Refund whose freeze journal is
 * not there is refused with RefundFreezeJournalMissingError, never counted as
 * having taken nothing: createRefund posts the journal in the same transaction
 * as the Refund row, so it cannot be missing in normal operation, and guessing
 * would release or charge the wrong share. With no ids nothing is read.
 */
export async function readRefundFreezeEntries(
  tx: Prisma.TransactionClient,
  refundIds: string[],
): Promise<RefundFreezeEntry[]> {
  if (refundIds.length === 0) return [];

  const entries = await tx.ledgerEntry.findMany({
    where: { transactionId: { in: refundIds.map((id) => refundFreezeTransactionId(id)) } },
    select: { transactionId: true, account: true, direction: true, amount: true },
  });

  const posted = new Set(entries.map((e) => e.transactionId));
  const missing = refundIds.filter((id) => !posted.has(refundFreezeTransactionId(id)));
  if (missing.length > 0) throw new RefundFreezeJournalMissingError(missing);

  return entries;
}
