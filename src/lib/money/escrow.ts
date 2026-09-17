import { prisma } from '@/lib/prisma';
import { escrowReleaseLegs, postTransaction } from './ledger';

/**
 * The escrow hold: how long settled money sits in ESCROW_HOLD before it
 * becomes withdrawable CAMPAIGN_BALANCE.
 *
 * One constant, in one file. Task M8 extends this same file with the sweep
 * that releases holds once they mature -- the hold length is not duplicated
 * anywhere else, because two copies of "7" in two files is how a hold period
 * silently becomes two different hold periods.
 */
export const ESCROW_HOLD_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * When a payment settled at `settledAt` stops being escrow and becomes
 * withdrawable.
 */
export function escrowReleaseAt(settledAt: Date): Date {
  return new Date(settledAt.getTime() + ESCROW_HOLD_DAYS * MS_PER_DAY);
}

/**
 * How many matured holds one call to `releaseMaturedEscrow` will process.
 *
 * There is no scheduler in this repo (see that function's doc comment), so
 * this sweep runs inline inside a user-facing request. Without a bound, a
 * backlog of matured holds -- built up while the sweep was never called, or
 * simply a platform with a lot of donations -- would turn one HTTP request
 * into a full-table sweep. Anything past this limit is left with
 * `escrowReleasedAt` still null and is picked up by the next call: the next
 * payout request for this or any other campaign, or a future scheduled
 * sweep. A request-time release only ever pays for a bounded slice of the
 * backlog; it does not promise to drain it in one call.
 */
export const ESCROW_RELEASE_SWEEP_LIMIT = 200;

export interface ReleaseSweepResult {
  /** Matured holds this call actually posted a release for. */
  releasedCount: number;
  /** Matured holds this call looked at, including ones it skipped or lost a race on. */
  consideredCount: number;
}

/**
 * Finds every Payment whose escrow hold has matured -- `escrowReleaseAt <=
 * now` and `escrowReleasedAt IS NULL` -- and moves its money out of
 * ESCROW_HOLD into the campaign's withdrawable CAMPAIGN_BALANCE. Pass a
 * campaignId to scope the sweep to one campaign (this is how the payout
 * request handler calls it); omit it to sweep across all campaigns.
 *
 * There is no scheduler anywhere in this repo, so this is what makes the
 * 7-day hold actually let go of money: it runs at the top of the payout
 * request handler, for the requesting campaign, so that a campaigner's
 * balance reflects every hold that has matured by the time they ask to
 * withdraw -- without a cron job existing at all.
 *
 * Idempotent by construction, so calling this twice concurrently -- two
 * payout requests for the same campaign landing at once, or a request
 * racing a future scheduled sweep -- posts one set of release entries per
 * payment, never two. Each payment is released in its own transaction,
 * keyed on `transactionId: \`escrow-release:${paymentId}\``, and claimed via
 * a status-predicated `updateMany` (WHERE escrowReleasedAt IS NULL) rather
 * than a read-then-write: the database arbitrates which of two concurrent
 * callers gets to release a given payment, and the loser sees `count === 0`
 * and does nothing further. A read-then-write here was Critical twice
 * already on this branch (see approveAndReleasePayout in ./payouts.ts for
 * the same pattern applied to payout approval).
 */
export async function releaseMaturedEscrow(campaignId?: string): Promise<ReleaseSweepResult> {
  const now = new Date();

  const matured = await prisma.payment.findMany({
    where: {
      // Only a settled payment can have anything left to release. A payment
      // that later moved to REFUNDED (fully refunded) has nothing of its own
      // left either, and excluding it here is cheaper than discovering that
      // inside the transaction below.
      status: 'PAID',
      escrowReleaseAt: { lte: now },
      escrowReleasedAt: null,
      ...(campaignId ? { donation: { campaignId } } : {}),
    },
    select: {
      id: true,
      amount: true,
      providerFee: true,
      donation: { select: { campaignId: true } },
    },
    // Oldest hold first, so that if the sweep limit below truncates the
    // list, which holds get left for the next call is deterministic rather
    // than whatever order the database happens to return.
    orderBy: { escrowReleaseAt: 'asc' },
    take: ESCROW_RELEASE_SWEEP_LIMIT,
  });

  if (matured.length === ESCROW_RELEASE_SWEEP_LIMIT) {
    // Silence here would mean a campaign sitting on a backlog bigger than
    // one sweep can look like nothing is wrong -- the caller sees a normal
    // result, and the only symptom is a campaigner needing to ask for a
    // payout more than once before every matured hold has actually released.
    console.warn(
      `releaseMaturedEscrow: hit the sweep limit of ${ESCROW_RELEASE_SWEEP_LIMIT}` +
        `${campaignId ? ` for campaign ${campaignId}` : ''} -- more matured holds remain ` +
        'and will be picked up by a later call.',
    );
  }

  let releasedCount = 0;
  for (const payment of matured) {
    const paymentCampaignId = payment.donation.campaignId;
    try {
      const released = await prisma.$transaction(async (tx) => {
        // Lock the campaign row before touching its ESCROW_HOLD /
        // CAMPAIGN_BALANCE accounts, the same precaution approveAndReleasePayout
        // takes before spending CAMPAIGN_BALANCE (./payouts.ts). amountToRelease
        // below is computed entirely from this payment's own fields and its own
        // Refund rows, never from a campaign-wide aggregate, so two sibling
        // payments of the same campaign releasing concurrently no longer share
        // anything this lock would need to protect -- it stays as the standing
        // guard for any future write in this function that does touch a shared
        // campaign aggregate.
        await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${paymentCampaignId} FOR UPDATE`;

        // Claim this payment before doing anything else. Whichever of two
        // concurrent sweeps commits this update first wins; the other sees
        // count 0 and stops here, before ever posting a ledger entry.
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, escrowReleasedAt: null },
          data: { escrowReleasedAt: now },
        });
        if (claimed.count === 0) return false;

        // The amount to release is the NET this payment originally credited
        // to ESCROW_HOLD (paymentSettledLegs credits amount - providerFee,
        // never the gross), minus whatever has already been refunded
        // specifically against THIS payment. Deliberately not capped against
        // the campaign's overall ESCROW_HOLD balance: that account is shared
        // by every payment still inside its hold window, so a cap measured
        // against the shared pot would let this payment's release "borrow"
        // headroom that in fact belongs to a sibling payment which has not
        // matured yet -- releasing it under THIS payment's transactionId and
        // bypassing that sibling's own hold window entirely. Refund.paymentId
        // is what ties a refund back to the specific payment it came out of
        // (refundLegs, ./ledger.ts, posts against a refundId, not a
        // paymentId, so the ledger itself cannot answer this -- the Refund
        // row is what's joined here). REJECTED refunds never moved money and
        // are excluded; every other status is treated as already spoken for,
        // so a refund in flight is not raced by a release.
        const netAmount = payment.amount - payment.providerFee;
        const refunds = await tx.refund.findMany({
          where: { paymentId: payment.id, status: { not: 'REJECTED' } },
          select: { amount: true },
        });
        const refundedAmount = refunds.reduce((sum, r) => sum + r.amount, 0);
        const amountToRelease = Math.max(0, netAmount - refundedAmount);

        if (amountToRelease > 0) {
          await postTransaction(
            tx,
            escrowReleaseLegs({ campaignId: paymentCampaignId, amount: amountToRelease }),
            { paymentId: payment.id, transactionId: `escrow-release:${payment.id}` },
          );
        }
        // amountToRelease <= 0 means a refund already took all of this
        // payment's held money before the hold matured -- there is nothing
        // left to move, so nothing is posted. escrowReleasedAt is already
        // stamped above regardless, so this payment is not reconsidered by
        // every future sweep.

        return true;
      });

      if (released) releasedCount++;
    } catch (err) {
      // One payment's failure must not stop the rest of the sweep -- a
      // single bad row must not block every other campaign's payout
      // requests from releasing their own matured holds.
      console.error(`releaseMaturedEscrow: failed to release payment ${payment.id}`, err);
    }
  }

  return { releasedCount, consideredCount: matured.length };
}
