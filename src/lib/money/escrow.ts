import { prisma } from '@/lib/prisma';
import {
  escrowReleaseLegs,
  platformFeePortionFor,
  postTransaction,
  providerFeePortionFor,
  type LedgerSubject,
} from './ledger';
import { assertExactlyOnePaymentSubject } from './payment-subject';
import { isEscrowReleaseFrozen, lockAndLoad } from '@/lib/subject-guard';

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
 *
 * `holdDays` defaults to the live constant, but every real caller (the
 * settlement webhook) passes the specific Payment's own frozen
 * `escrowHoldDays` instead (CONTEXT.md, Escrow Hold; prd-compliance 18): the
 * length is decided once, at Payment creation, and a later Admin change to
 * the default must not move a Payment already created under the old one.
 */
export function escrowReleaseAt(settledAt: Date, holdDays: number = ESCROW_HOLD_DAYS): Date {
  return new Date(settledAt.getTime() + holdDays * MS_PER_DAY);
}

/**
 * How many matured holds one call to `releaseMaturedEscrow` will process.
 *
 * Both of the sweep's callers are bounded by this for the same reason: it
 * runs inside a user-facing request (the Payout request handlers) or
 * inside a scheduled run (./scheduled-jobs.ts), and a backlog of matured
 * holds -- built up between calls, or simply a platform with a lot of
 * donations -- would otherwise turn either one into a full-table sweep.
 * Anything past this limit is left with `escrowReleasedAt` still null and
 * is picked up by the next call: the next payout request for any campaign
 * or trip, or the next scheduled run. Either way a single call only ever
 * pays for a bounded slice of the backlog; it does not promise to drain it.
 */
export const ESCROW_RELEASE_SWEEP_LIMIT = 200;

/**
 * How long a payment's escrow hold can sit matured but unreleased before the
 * reconciliation report (GET /api/admin/reconcile) flags it as quiet rather
 * than merely deferred.
 *
 * releaseMaturedEscrow defers a payment entirely, correctly, while any
 * refund against it is REQUESTED or PROCESSING -- see that function's own
 * comment. That deferral is meant to last as long as a refund normally
 * takes to resolve, not forever: a refund left stuck open in REQUESTED
 * defers its payment's escrow indefinitely, and strandedEscrow (the
 * reconcile report's other escrow check) cannot see it, because that check
 * only ever looks at payments where escrowReleasedAt is already set -- a
 * deferred payment's is null by construction. Nothing else reports this, so
 * money can go quiet with no visibility at all.
 *
 * Set to double ESCROW_HOLD_DAYS: a full extra hold period of grace for a
 * refund to resolve normally, on top of the wait a payment already went
 * through to mature in the first place, before this treats "still open" as
 * worth a human's attention instead of business as usual.
 */
export const DEFERRED_ESCROW_WATCHDOG_DAYS = ESCROW_HOLD_DAYS * 2;

/**
 * The cutoff for DEFERRED_ESCROW_WATCHDOG_DAYS above: a payment whose
 * escrowReleaseAt is at or before this instant, and which is still
 * unreleased, has been overdue long enough to report. Computed here, next
 * to the constant it derives from, for the same reason escrowReleaseAt
 * itself is -- one place does the day arithmetic, not each caller by hand.
 */
export function deferredEscrowWatchdogCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - DEFERRED_ESCROW_WATCHDOG_DAYS * MS_PER_DAY);
}

export interface ReleaseSweepResult {
  /** Matured holds this call actually posted a release for. */
  releasedCount: number;
  /** Matured holds this call looked at, including ones it skipped or lost a race on. */
  consideredCount: number;
}

/** Which Campaign-or-Trip to scope a release sweep to. Omit to sweep across all subjects. */
export interface ReleaseSweepSubject {
  type: 'campaign' | 'trip';
  id: string;
}

/**
 * Finds every Payment whose escrow hold has matured -- `escrowReleaseAt <=
 * now` and `escrowReleasedAt IS NULL` -- and moves its money out of
 * ESCROW_HOLD into its subject's withdrawable CAMPAIGN_BALANCE or
 * TRIP_BALANCE. Pass a subject to scope the sweep to one campaign or trip
 * (this is how the payout request handler calls it); omit it to sweep
 * across every subject. A Suspended Campaign's payments are skipped and
 * stay in ESCROW_HOLD until the Suspension is lifted (see the loop below).
 *
 * Two paths call this. The Payout request handlers call it for the
 * requesting Campaign (or Trip) alone, so a hold releases when that
 * Fundraiser asks to withdraw, and not otherwise. `runScheduledJobs`
 * (./scheduled-jobs.ts) is the second: it sweeps every subject at once.
 *
 * Being callable is not being called. Nothing invokes the scheduled path
 * until an owner installs the scheduler (ticket 45), so today this
 * request-time sweep is the only one that moves money: a matured hold on a
 * Campaign nobody has asked to pay out is still in ESCROW_HOLD.
 *
 * Idempotent by construction, so calling this twice concurrently -- two
 * payout requests for the same campaign landing at once, a request racing
 * the scheduled sweep (runScheduledJobs, ticket 20), or two scheduler
 * runners overlapping -- posts one set of release entries per payment,
 * never two. Each payment is released in its own transaction, keyed on
 * `transactionId: \`escrow-release:${paymentId}\``, and claimed via a
 * status-predicated `updateMany` (WHERE escrowReleasedAt IS NULL) rather
 * than a read-then-write: the database arbitrates which of two concurrent
 * callers gets to release a given payment, and the loser sees `count === 0`
 * and does nothing further. A read-then-write here was Critical twice
 * already on this branch (see approvePayout in ./payouts.ts for
 * the same pattern applied to payout approval).
 *
 * The claim below is also why the ledger needs no guard of its own here:
 * even a caller that skipped it could not double-post, because the ledger
 * refuses a transactionId twice (prd-compliance 28b,
 * LedgerEntry_transactionId_claim_key). It keeps the loser from reaching the
 * ledger at all, which is a quiet no-op rather than an aborted transaction
 * and an error in this sweep's log.
 *
 * `now` defaults to the live clock; the scheduled job (./scheduled-jobs.ts)
 * passes its own injected `now` so it can be driven directly in tests,
 * never through timers, same as every other `now`-taking function in this
 * codebase (expireIfPastDeadline, expiringWindows).
 */
export async function releaseMaturedEscrow(
  subject?: ReleaseSweepSubject,
  now: Date = new Date(),
): Promise<ReleaseSweepResult> {

  const matured = await prisma.payment.findMany({
    where: {
      // Only a settled payment can have anything left to release. A payment
      // that later moved to REFUNDED (fully refunded) has nothing of its own
      // left either, and excluding it here is cheaper than discovering that
      // inside the transaction below.
      status: 'PAID',
      escrowReleaseAt: { lte: now },
      escrowReleasedAt: null,
      ...(subject?.type === 'campaign' ? { donation: { campaignId: subject.id } } : {}),
      ...(subject?.type === 'trip' ? { registration: { batch: { tripId: subject.id } } } : {}),
    },
    select: {
      id: true,
      amount: true,
      providerFee: true,
      // Read as 0 when absent, like every other reader of this column
      // (platformFeePortionFor in ./ledger.ts, the settlement webhook): a
      // Payment that predates the column, or a Trip Fee Payment, carries no
      // Platform Fee. Selected here because the release has to move the same
      // NET paymentSettledLegs credited -- not Gross minus the Provider Fee
      // alone, which over-drew ESCROW_HOLD by the Platform Fee and paid it
      // out again as withdrawable Campaign Balance.
      platformFee: true,
      donationId: true,
      registrationId: true,
      donation: { select: { campaignId: true } },
      registration: { select: { batch: { select: { tripId: true } } } },
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
        `${subject ? ` for ${subject.type} ${subject.id}` : ''} -- more matured holds remain ` +
        'and will be picked up by a later call.',
    );
  }

  let releasedCount = 0;
  for (const payment of matured) {
    try {
      // A malformed Payment (both or neither of donationId/registrationId
      // set) must fail only this one row -- caught below and logged, same
      // as any other per-payment failure -- not throw before the loop even
      // starts and abort every other campaign/trip's release in this sweep.
      assertExactlyOnePaymentSubject({
        donationId: payment.donationId,
        registrationId: payment.registrationId,
      });
      const paymentSubject: LedgerSubject = payment.donationId != null
        ? { type: 'campaign', campaignId: payment.donation!.campaignId }
        : { type: 'trip', tripId: payment.registration!.batch.tripId };

      const released = await prisma.$transaction(async (tx) => {
        // Lock the subject row before touching its ESCROW_HOLD / balance
        // accounts, through the subject guard, which fixes the lock order
        // (subject, then Payment) for every money path
        // (src/lib/subject-guard.ts). amountToRelease below is computed
        // entirely from this payment's own fields and its own Refund rows,
        // never from a campaign-wide aggregate, so two sibling payments of
        // the same campaign releasing concurrently no longer share anything
        // this lock would need to protect -- it stays as the standing guard
        // for any future write in this function that does touch a shared
        // campaign aggregate.
        //
        // WHY THE WEBHOOK DOESN'T DEADLOCK WITH THIS. The settlement webhook
        // (src/app/api/webhooks/[provider]/route.ts) stays outside the guard
        // and goes the other way: Payment, then Donation, then Campaign, with
        // no explicit row lock. The two never contend for the same Payment
        // row only because the webhook writes a Payment while it is still
        // PENDING, and this sweep's candidate set is `status: 'PAID'` (the
        // query above). That is a load-bearing accident of the current status
        // values, not a rule enforced in code: a new path that touches a
        // PAID payment in Payment -> subject order reintroduces the deadlock.
        // The Trip branch of the webhook holds the same invariant.
        const subjectState = await lockAndLoad(tx, paymentSubject, now);

        // A Suspended Campaign's matured money stays in Escrow Hold. Nothing
        // is claimed or posted, so escrowReleasedAt stays null and the first
        // sweep after the Suspension is lifted picks this payment up again,
        // with no manual step. Judged under the lock, so a Suspension
        // committed before it is seen. A missing subject is left to the
        // release below, as before.
        if (subjectState && isEscrowReleaseFrozen(subjectState)) return false;

        // Every refund against THIS payment, whatever its status. Refund.paymentId
        // is what ties a refund back to the specific payment it came out of
        // (refundRequestedLegs/refundApprovedLegs, ./ledger.ts, post against a
        // refundId, never a paymentId, so the ledger itself cannot answer this --
        // the Refund row is what's joined here).
        const refunds = await tx.refund.findMany({
          where: { paymentId: payment.id },
          orderBy: { createdAt: 'asc' },
          select: { amount: true, status: true },
        });

        // escrowReleasedAt means "this payment's escrow is settled, for
        // good" -- the sweep's own predicate treats it as permanent and will
        // never look at this payment again. That can only be true once every
        // refund against it has a FINAL outcome. REQUESTED and PROCESSING are
        // not final: the money might come back to the campaign (REJECTED) or
        // leave for good (COMPLETED), and which one hasn't happened yet.
        // Stamping now and computing amountToRelease as 0 -- as if the refund
        // had already completed -- would look identical to "this payment's
        // money is genuinely gone" on every future sweep, and if the refund
        // is later REJECTED, that money would sit in ESCROW_HOLD stranded
        // forever with nothing left to ever release it. So an in-flight
        // refund defers the whole payment: nothing is claimed, nothing is
        // posted, and escrowReleaseAt/escrowReleasedAt still say "not yet
        // resolved", which is exactly true -- a later sweep, after the
        // refund resolves, picks this payment up again.
        const hasRefundInFlight = refunds.some((r) => r.status === 'REQUESTED' || r.status === 'PROCESSING');
        if (hasRefundInFlight) return false;

        // Claim this payment before doing anything else. Whichever of two
        // concurrent sweeps commits this update first wins; the other sees
        // count 0 and stops here, before ever posting a ledger entry. Kept
        // rather than left to the ledger's claim index (prd-compliance 28b):
        // the index would refuse the second post anyway, but only by failing
        // this transaction, which a sweep would log as a broken payment.
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, escrowReleasedAt: null },
          data: { escrowReleasedAt: now },
        });
        if (claimed.count === 0) return false;

        // Every refund above is now final (COMPLETED or REJECTED), so the
        // amount to release is knowable for good: the NET this payment
        // originally credited to ESCROW_HOLD (paymentSettledLegs credits
        // `gross - providerFee - platformFee`, never the gross), minus the NET
        // share each non-REJECTED/FAILED refund actually removed from this
        // same account at freeze time. Each such refund's freeze
        // (refundRequestedLegs, ./ledger.ts) debits ESCROW_HOLD only its own
        // net portion -- the fee portion went straight to REFUND_COST/
        // PLATFORM_FEE at freeze time, never out of this account -- so what
        // is left to release is netAmount minus the SUM of those net
        // shares, not minus their gross amounts. Recomputed here in
        // creation order via the same cumulative-fee-cap helper
        // createRefund/approveRefund use, so it reproduces exactly what was
        // posted. REJECTED/FAILED refunds never moved money and are
        // excluded. Deliberately not capped against the campaign's overall
        // ESCROW_HOLD balance: that account is shared by every payment
        // still inside its own hold window, so a cap measured against the
        // shared pot would let this payment's release "borrow" headroom
        // that in fact belongs to a sibling payment which has not matured
        // yet.
        const netAmount = payment.amount - payment.providerFee - (payment.platformFee ?? 0);
        const nonRejectedAmounts = refunds
          .filter((r) => r.status !== 'REJECTED' && r.status !== 'FAILED')
          .map((r) => r.amount);
        // BOTH shares, not the Provider Fee's alone: the freeze debited
        // ESCROW_HOLD by `amount - platformFeePortion - providerFeePortion`
        // (./refunds.ts passes both to refundRequestedLegs; both come from the
        // same cumulative-cap helper, so the two calls here reproduce that
        // exact figure). Leaving the Platform Fee's out released less than was
        // really held and stranded the difference for good, escrowReleasedAt
        // having been stamped before this posts.
        let refundedNetAmount = 0;
        for (let i = 0; i < nonRejectedAmounts.length; i++) {
          const priorAmounts = nonRejectedAmounts.slice(0, i);
          const platformFeePortion = platformFeePortionFor(payment, nonRejectedAmounts[i], priorAmounts);
          const providerFeePortion = providerFeePortionFor(payment, nonRejectedAmounts[i], priorAmounts);
          refundedNetAmount += nonRejectedAmounts[i] - platformFeePortion - providerFeePortion;
        }
        const amountToRelease = Math.max(0, netAmount - refundedNetAmount);

        if (amountToRelease > 0) {
          await postTransaction(
            tx,
            escrowReleaseLegs({ subject: paymentSubject, amount: amountToRelease }),
            { paymentId: payment.id, transactionId: `escrow-release:${payment.id}` },
          );
        }
        // amountToRelease <= 0 means a COMPLETED refund already took all of
        // this payment's held money -- a final outcome, not a guess -- so
        // there is genuinely nothing left to move. escrowReleasedAt is
        // already stamped above, and correctly so: this payment is finished,
        // not merely quiet for now.

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
