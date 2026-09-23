import { prisma } from '@/lib/prisma';

/**
 * Finds every Registration still HOLD whose holdExpiresAt has passed and
 * flips it to EXPIRED, freeing the seat for the next registration attempt
 * (HOLD no longer counts toward maxQuota once it's EXPIRED).
 *
 * Modeled directly on releaseMaturedEscrow's shape (src/lib/money/
 * escrow.ts): no scheduler exists in this repo, so this runs at the top of
 * the registration route, for the requesting Batch, the same way escrow
 * release runs at the top of a payout request. Pass a batchId to scope the
 * sweep to one Batch (how the registration route calls it); omit it to
 * sweep across all Batches.
 *
 * A plain updateMany, not a per-row transaction like releaseMaturedEscrow:
 * this sweep moves no money and posts no ledger entries, so there is no
 * per-row financial invariant to protect with a lock -- flipping a status
 * column is safe to batch in one statement.
 */
export async function releaseExpiredHolds(
  batchId?: string,
): Promise<{ expiredCount: number; consideredCount: number }> {
  const now = new Date();

  const expired = await prisma.registration.findMany({
    where: {
      status: 'HOLD',
      holdExpiresAt: { lte: now },
      ...(batchId ? { batchId } : {}),
    },
    select: { id: true },
  });

  if (expired.length === 0) {
    return { expiredCount: 0, consideredCount: 0 };
  }

  const ids = expired.map((r) => r.id);
  const updated = await prisma.registration.updateMany({
    where: { id: { in: ids }, status: 'HOLD' },
    data: { status: 'EXPIRED' },
  });

  return { expiredCount: updated.count, consideredCount: expired.length };
}
