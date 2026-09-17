import { prisma } from '@/lib/prisma';
import { escrowBalance, escrowReleaseLegs, postTransaction } from './ledger';

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
    take: ESCROW_RELEASE_SWEEP_LIMIT,
  });

  let releasedCount = 0;
  for (const payment of matured) {
    const paymentCampaignId = payment.donation.campaignId;
    try {
      const released = await prisma.$transaction(async (tx) => {
        // Lock the campaign row before touching its ESCROW_HOLD /
        // CAMPAIGN_BALANCE pot, for the same reason approveAndReleasePayout
        // locks it before spending CAMPAIGN_BALANCE (./payouts.ts): two
        // different payments maturing for the SAME campaign at once would
        // otherwise both read the same pre-release escrow balance below and
        // could together release more than the campaign's ESCROW_HOLD
        // actually holds.
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
        // never the gross), capped at what the campaign's ESCROW_HOLD
        // account actually holds right now. The cap is what keeps a refund
        // honest: a refund inside the hold window debits ESCROW_HOLD
        // directly (refundLegs, ./ledger.ts), so if this payment's share of
        // that shared, campaign-level account has already gone back to a
        // donor, there is less than the full net left to release -- possibly
        // nothing. Releasing the net amount unconditionally would debit
        // ESCROW_HOLD past what a refund left in it and drive the account
        // negative, which is exactly the failure this cap exists to rule
        // out.
        const netAmount = payment.amount - payment.providerFee;
        const held = await escrowBalance(tx, paymentCampaignId);
        const amountToRelease = Math.min(netAmount, held);

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
