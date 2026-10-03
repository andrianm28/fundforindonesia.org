import type { Refund } from '@/generated/prisma/client';
import { RefundExceedsRemainingError } from '@/lib/money/errors';
import { prisma } from '@/lib/prisma';
import { refundLateSettlement } from './trip';

/** Registrations one round may attempt. Bounded so a backlog drains over rounds, not in one request. */
export const REFUND_SWEEP_LIMIT = 50;

export interface RefundSweepResult {
  /** Candidates this round found (<= limit). */
  consideredCount: number;
  /** Candidates handed to refundLateSettlement; named as in ticket 14's reminder sweeps. */
  attemptedCount: number;
  /** Attempts that created a Refund. */
  refundedCount: number;
  /** Attempts that found nothing to do: another sweep or the webhook refunded it first. */
  skippedCount: number;
  /** Attempts that threw; logged by Registration id only. */
  failedCount: number;
}

export interface RefundSweepOptions {
  limit?: number;
  /** Injected in tests to make one Registration fail; defaults to refundLateSettlement. */
  refund?: (
    client: typeof prisma,
    params: { registrationId: string; now?: Date },
  ) => Promise<{ refund: Refund | null }>;
}

/**
 * Ticket 43: finds Trip Fees that settled after their Registration was
 * CANCELLED or EXPIRED but were never refunded -- the webhook calls
 * `refundLateSettlement` after its Settlement commits and only logs a failure
 * -- and calls `refundLateSettlement` for each. It writes no ledger of its
 * own; idempotency is the one `refundLateSettlement`/`createRefund` already
 * has (Trip -> Registration -> Payment row locks, then the remaining-amount
 * check), so two concurrent sweeps cannot create two Refunds: the loser
 * either sees the Refund under the lock or hits RefundExceedsRemainingError,
 * which is counted as skipped, not failed.
 *
 * A candidate is a Registration whose Payment is PAID and has no Refund in any
 * status, and either is EXPIRED (a CONFIRMED Registration never becomes
 * EXPIRED, so a PAID Payment there is always a late settlement) or is
 * CANCELLED with its settlement ledger legs written AFTER the Registration
 * last changed. That last test matters: a Volunteer who cancels a CONFIRMED
 * Registration inside the no-refund window (tripFeeRefundAmount is 0) also
 * ends CANCELLED + PAID with no Refund, by policy, and must not be refunded
 * in full. There the settlement predates the cancellation. A CANCELLED
 * Registration is not written again after cancelling, so `updatedAt` is the
 * cancellation time. (A settlement that began just before, and committed just
 * after, a cancellation can read as "before" and be skipped: it stays stuck
 * rather than being refunded wrongly.)
 *
 * Bounded by `limit`, oldest status change first, rows that failed before
 * behind rows that never have (Payment.refundSweepFailedAt) so permanent
 * failures cannot starve the rest. CONFIRMED is never selected.
 */
export async function sweepStuckLateSettlementRefunds(
  now: Date = new Date(),
  options: RefundSweepOptions = {},
): Promise<RefundSweepResult> {
  const { limit = REFUND_SWEEP_LIMIT, refund = refundLateSettlement } = options;

  const candidates = await prisma.$queryRaw<Array<{ registrationId: string; paymentId: string }>>`
    SELECT r.id AS "registrationId", p.id AS "paymentId"
    FROM "Registration" r
    JOIN "Payment" p ON p."registrationId" = r.id
    WHERE p.status = 'PAID'
      AND NOT EXISTS (SELECT 1 FROM "Refund" f WHERE f."paymentId" = p.id)
      AND (
        r.status = 'EXPIRED'
        OR (
          r.status = 'CANCELLED'
          AND (
            SELECT MIN(le."createdAt") FROM "LedgerEntry" le
            WHERE le."paymentId" = p.id AND le.account = 'ESCROW_HOLD' AND le.direction = 'CREDIT'
          ) > r."updatedAt"
        )
      )
    ORDER BY p."refundSweepFailedAt" ASC NULLS FIRST, r."updatedAt" ASC, r.id ASC
    LIMIT ${limit}
  `;

  const result: RefundSweepResult = {
    consideredCount: candidates.length,
    attemptedCount: 0,
    refundedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };

  for (const candidate of candidates) {
    result.attemptedCount++;
    try {
      const { refund: created } = await refund(prisma, { registrationId: candidate.registrationId, now });
      if (created) result.refundedCount++;
      else result.skippedCount++;
    } catch (err) {
      if (err instanceof RefundExceedsRemainingError) {
        result.skippedCount++;
        continue;
      }
      result.failedCount++;
      // Ids only: no name, email or account detail reaches the log.
      console.error(
        `refund sweep: failed to refund registration ${candidate.registrationId} (payment ${candidate.paymentId})`,
        err instanceof Error ? err.name : 'unknown error',
      );
      try {
        await prisma.payment.update({ where: { id: candidate.paymentId }, data: { refundSweepFailedAt: now } });
      } catch {
        // Rotation is best effort; the failure itself is already logged.
      }
    }
  }
  return result;
}
