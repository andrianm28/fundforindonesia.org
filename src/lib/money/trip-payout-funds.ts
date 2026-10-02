import type { Prisma } from '@/generated/prisma/client';
import { tripBalance } from './ledger';
import { TripPayoutFundsNotCompletedError } from '@/lib/volunteer-trip-errors';

/**
 * Ticket 49 (owner decision 2026-10-02; CONTEXT.md, Payout): a Trip Fee
 * Payout may only spend money that came from a COMPLETED Batch.
 *
 * TRIP_BALANCE is kept per Trip, not per Batch, but every Trip Fee ledger
 * entry is attributable to a Batch through its Payment (or, for a Refund
 * leg, through the Refund's Payment) -> Registration -> Batch. So the rule
 * is enforced as a ceiling, not as a ban on the whole Trip:
 *
 *   withdrawable = TRIP_BALANCE - (net TRIP_BALANCE of Batches not COMPLETED)
 *
 * Payout legs belong to no Batch, so they are not in the held figure, which
 * is what makes the subtraction right: a Payout already instructed lowers
 * the balance and not the held part. A Trip with one finished Batch and one
 * still open keeps the finished one's money available; the open one's stays
 * refundable. A Batch that is cancelled holds only whatever the refunds left
 * (nothing, for the full Refund a cancellation pays) until it is COMPLETED,
 * which a cancelled Batch never is -- a residue there stays held, the safe
 * side.
 *
 * Called under the Trip row lock every Trip transition and Trip Refund also
 * takes (lockAndLoad), so completing or cancelling a Batch cannot interleave
 * with the read.
 */
export async function tripHeldBalance(tx: Prisma.TransactionClient, tripId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ held: bigint | number | string | null }>>`
    SELECT COALESCE(SUM(CASE WHEN le."direction" = 'CREDIT' THEN le."amount" ELSE -le."amount" END), 0) AS held
    FROM "LedgerEntry" le
    LEFT JOIN "Refund" r ON r."id" = le."refundId"
    JOIN "Payment" p ON p."id" = COALESCE(le."paymentId", r."paymentId")
    JOIN "Registration" reg ON reg."id" = p."registrationId"
    JOIN "VolunteerBatch" b ON b."id" = reg."batchId"
    WHERE le."account" = 'TRIP_BALANCE'
      AND le."volunteerTripId" = ${tripId}
      AND b."status" <> 'COMPLETED'
  `;
  const held = Number(rows[0]?.held ?? 0);
  return Number.isFinite(held) ? held : 0;
}

/** What a Trip may pay out now: its balance less the part still refundable. Never above the balance. */
export async function tripWithdrawableBalance(tx: Prisma.TransactionClient, tripId: string): Promise<number> {
  const balance = await tripBalance(tx, tripId);
  const held = await tripHeldBalance(tx, tripId);
  return balance - Math.max(held, 0);
}

/**
 * Refuses a Payout of `amount` that reaches into money of a Batch that is not
 * COMPLETED. At completion the Payout's own amount is already debited from
 * TRIP_BALANCE (at approval), so it is asked with 0: the balance left must
 * still cover what is held.
 */
export async function requireTripFundsFromCompletedBatches(
  tx: Prisma.TransactionClient,
  tripId: string,
  amount: number,
): Promise<void> {
  const withdrawable = await tripWithdrawableBalance(tx, tripId);
  if (amount > withdrawable) {
    throw new TripPayoutFundsNotCompletedError(amount, Math.max(withdrawable, 0));
  }
}
