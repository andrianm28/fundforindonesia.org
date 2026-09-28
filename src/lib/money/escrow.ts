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
 * How many Payments one call to `releaseMaturedEscrow` will actually release.
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
 *
 * This used to also be the query's own `take`, and that coupling was ticket
 * 15's bug: a row a permanent guard defers (isEscrowReleaseFrozen for a
 * SUSPENDED Campaign/Trip, or an in-flight Refund) is left with
 * `escrowReleaseAt` unchanged -- correctly, changing it would be an
 * accounting error -- so it sorted right back to the front of the very next
 * call's oldest-first query too. Once ESCROW_RELEASE_SWEEP_LIMIT such rows
 * existed, every call read the same rows, released none of them, and every
 * genuinely matured Payment behind them was never read at all. See
 * `escrowSweepDeferredAt` (schema.prisma, Payment) and
 * ESCROW_RELEASE_SWEEP_SCAN_LIMIT below for what actually fixes that -- this
 * constant still bounds how many *releases* one call performs, no longer how
 * many rows it is willing to look at to find them.
 */
export const ESCROW_RELEASE_SWEEP_LIMIT = 200;

/**
 * The query's own `take`: how many matured Payments one call to
 * `releaseMaturedEscrow` reads and considers, in the rotation order below,
 * before it ever starts releasing.
 *
 * Ticket 15. A Payment a permanent guard defers is stamped
 * `escrowSweepDeferredAt` (see the transaction below and that column's own
 * comment in schema.prisma) and the query orders on that column first --
 * nulls (never deferred) ahead of any timestamp, oldest-deferred-first among
 * the rest -- so a Payment this call finds still stuck rotates BEHIND every
 * Payment that has not been, on the very next call. `escrowReleaseAt`/
 * `escrowReleasedAt` are never touched by this: doing so would be the
 * accounting error the ticket explicitly rules out. The practical effect: no
 * number of permanently-stuck Payments can ever again fill every future
 * call's `take` and starve the genuinely releasable Payments behind them --
 * unlike ESCROW_RELEASE_SWEEP_LIMIT above, raising or lowering this constant
 * changes only how much of the backlog one call is willing to READ, never
 * whether starvation is possible.
 *
 * Set well above ESCROW_RELEASE_SWEEP_LIMIT so an ordinary backlog of
 * ordinary, eventually-releasable rows never comes close to it -- the query
 * coming back full (`length === scanLimit`) without having filled the
 * release quota is itself the signal (see the warning in
 * releaseMaturedEscrow below) that a permanently-stuck backlog, not an
 * ordinary one, dominated this call.
 *
 * Takes an optional override -- `releaseMaturedEscrow`'s own `scanLimit`
 * parameter -- rather than being read as a bare constant everywhere, so a
 * test that needs to prove the rotation across many calls is not forced to
 * seed ten times ESCROW_RELEASE_SWEEP_LIMIT real rows to do it (see the
 * integration test in src/__tests__/integration/escrow-sweep-rotation.test.ts).
 * Production code never passes it; the default below is what every real
 * caller gets.
 */
export const ESCROW_RELEASE_SWEEP_SCAN_LIMIT = ESCROW_RELEASE_SWEEP_LIMIT * 10;

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
 * Options a caller can override. Every real caller (the Payout request
 * handlers, ./scheduled-jobs.ts) omits this entirely and gets the constants'
 * defaults; `scanLimit` exists so a test can prove the rotation across many
 * calls without seeding ESCROW_RELEASE_SWEEP_SCAN_LIMIT real rows to do it --
 * see that constant's own comment. Deliberately not a way to mutate the
 * exported constant itself, which stays the single default every production
 * path shares.
 */
export interface ReleaseSweepOptions {
  scanLimit?: number;
}

/**
 * What one Payment's pass through the release transaction below actually
 * did, ticket 15's addition to the sweep's own bookkeeping:
 *
 *  - `released`   -- claimed and (if anything was left to release) posted.
 *  - `frozen`      -- deferred by isEscrowReleaseFrozen: a SUSPENDED subject.
 *  - `deferred`    -- deferred by an in-flight Refund (REQUESTED/PROCESSING).
 *  - `raceLost`    -- another concurrent release claimed this Payment first.
 *
 * `frozen` and `deferred` are the two PERMANENT guards this ticket is about:
 * neither changes `escrowReleaseAt` or `escrowReleasedAt`, so the row is
 * still eligible and still just as old on the very next call -- which is
 * exactly why each one also stamps `escrowSweepDeferredAt` (see the
 * transaction below and that column's own comment in schema.prisma).
 * `raceLost` is not permanent in the same sense -- the winner of that race
 * already stamped `escrowReleasedAt`, so this Payment drops out of every
 * future sweep's query on its own, guard or no guard, and gets no deferral
 * stamp either -- but it is still not a release this call gets credit for,
 * so it is tracked separately from `released` rather than folded into it.
 */
type SweepOutcome = 'released' | 'frozen' | 'deferred' | 'raceLost';

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
 * (SweepOutcome `raceLost`) and does nothing further. A read-then-write here
 * was Critical twice already on this branch (see approvePayout in
 * ./payouts.ts for the same pattern applied to payout approval).
 *
 * The claim below is also why the ledger needs no guard of its own here:
 * even a caller that skipped it could not double-post, because the ledger
 * refuses a transactionId twice (prd-compliance 28b,
 * LedgerEntry_transactionId_claim_key). It keeps the loser from reaching the
 * ledger at all, which is a quiet no-op rather than an aborted transaction
 * and an error in this sweep's log.
 *
 * ROTATION ACROSS CALLS (ticket 15). One query reads up to `scanLimit`
 * (ESCROW_RELEASE_SWEEP_SCAN_LIMIT by default) matured candidates, ordered
 * `escrowSweepDeferredAt ASC NULLS FIRST, escrowReleaseAt ASC, id ASC` -- not
 * `escrowReleaseAt` alone. A Payment this or an earlier call found `frozen`
 * or `deferred` has that column stamped with the `now` it was skipped at
 * (see the transaction below), so it sorts BEHIND every Payment that has
 * never been skipped, and, among skipped Payments, oldest-skipped-first.
 * `escrowReleaseAt`/`escrowReleasedAt` are never touched by this -- doing so
 * would be the accounting error the ticket explicitly rules out -- so the
 * hold's real maturity date and release state stay exactly what they always
 * were. The practical effect: no number of permanently-stuck Payments can
 * ever again fill every future call's read and starve the genuinely
 * releasable Payments behind them, because a stuck Payment keeps rotating to
 * the back of the query on every call that finds it still stuck, rather than
 * sitting at the very front forever. `id` last breaks ties deterministically
 * (two Payments stamped in the very same instant, or maturing in the same
 * instant, would otherwise have no fixed relative order).
 *
 * Rows are then processed in that same order, oldest-marked-as-safe-to-look-at
 * first, until either ESCROW_RELEASE_SWEEP_LIMIT have actually been released
 * or the read runs out -- a single pass, no further paging or cursor: this
 * file used to page past a `frozen`/`deferred` run within one call too, but
 * that paging is what the ordering above already makes unnecessary for
 * starvation-safety, and it could not be proved against a real Postgres
 * cursor without risking exactly the reordering hazard the marker write
 * below is designed around (see that comment).
 *
 * `now` defaults to the live clock; the scheduled job (./scheduled-jobs.ts)
 * passes its own injected `now` so it can be driven directly in tests,
 * never through timers, same as every other `now`-taking function in this
 * codebase (expireIfPastDeadline, expiringWindows).
 */
export async function releaseMaturedEscrow(
  subject?: ReleaseSweepSubject,
  now: Date = new Date(),
  options: ReleaseSweepOptions = {},
): Promise<ReleaseSweepResult> {
  const scanLimit = options.scanLimit ?? ESCROW_RELEASE_SWEEP_SCAN_LIMIT;

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
    // escrowSweepDeferredAt first (nulls -- never skipped -- first), so a
    // Payment a permanent guard skipped on an earlier call rotates behind
    // every Payment that has not been; escrowReleaseAt next, oldest hold
    // first, exactly as before within each of those two groups; id last to
    // break ties deterministically (ticket 15 -- see the function's own doc
    // comment above).
    orderBy: [
      { escrowSweepDeferredAt: { sort: 'asc', nulls: 'first' } },
      { escrowReleaseAt: 'asc' },
      { id: 'asc' },
    ],
    take: scanLimit,
  });

  let releasedCount = 0;
  let consideredCount = 0;
  let permanentlySkippedCount = 0;
  // Payment ids this call found frozen/deferred, stamped in one batch AFTER
  // the loop below finishes rather than one at a time as each is found
  // (ticket 15). `matured` above was already read in full before this loop
  // starts, so nothing here can reorder a row out from under an
  // already-issued query the way writing the column mid-scan risked when
  // this file still paged within a call -- but the batch is kept anyway: it
  // is one write instead of up to `scanLimit`, and it keeps this loop doing
  // nothing but reading and deciding, never also writing state the next
  // iteration's order could depend on.
  const permanentlySkippedIds: string[] = [];

  for (const payment of matured) {
    if (releasedCount >= ESCROW_RELEASE_SWEEP_LIMIT) break;
    consideredCount++;

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

      const outcome: SweepOutcome = await prisma.$transaction(async (tx) => {
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
        // release below, as before. PERMANENT guard (ticket 15): this row
        // is just as eligible, and just as old (escrowReleaseAt/
        // escrowReleasedAt untouched), on the very next call -- the caller
        // stamps escrowSweepDeferredAt for it (batched, after this whole
        // loop; see the comment on permanentlySkippedIds above) so it
        // rotates behind never-skipped rows in that next query.
        if (subjectState && isEscrowReleaseFrozen(subjectState)) return 'frozen';

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
        // refund resolves, picks this payment up again. PERMANENT guard
        // (ticket 15) for as long as the refund stays open -- stamped the
        // same way and for the same reason as the frozen branch above.
        const hasRefundInFlight = refunds.some((r) => r.status === 'REQUESTED' || r.status === 'PROCESSING');
        if (hasRefundInFlight) return 'deferred';

        // Claim this payment before doing anything else. Whichever of two
        // concurrent sweeps commits this update first wins; the other sees
        // count 0 and stops here, before ever posting a ledger entry. Kept
        // rather than left to the ledger's claim index (prd-compliance 28b):
        // the index would refuse the second post anyway, but only by failing
        // this transaction, which a sweep would log as a broken payment.
        // escrowSweepDeferredAt is cleared in the same write, not left
        // stamped, so a Payment that WAS stuck and now finally releases
        // reads identically to one that was never stuck at all -- nothing
        // else in this codebase currently reads the column, but a Payment
        // permanently marked "was once deferred" after it is done and
        // released would be a false trail for whatever reads it next.
        // Harmless to the claim's own race-safety: the predicate below is
        // still `escrowReleasedAt IS NULL` alone, and this extra field is
        // written only by whichever caller's updateMany actually matches.
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, escrowReleasedAt: null },
          data: { escrowReleasedAt: now, escrowSweepDeferredAt: null },
        });
        if (claimed.count === 0) return 'raceLost';

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

        return 'released';
      });

      if (outcome === 'released') {
        releasedCount++;
      } else if (outcome === 'frozen' || outcome === 'deferred') {
        permanentlySkippedCount++;
        permanentlySkippedIds.push(payment.id);
      }
    } catch (err) {
      // One payment's failure must not stop the rest of the sweep -- a
      // single bad row must not block every other campaign's payout
      // requests from releasing their own matured holds.
      console.error(`releaseMaturedEscrow: failed to release payment ${payment.id}`, err);
    }
  }

  // One batch write for every row this call found frozen/deferred, now that
  // the loop above is entirely finished (see permanentlySkippedIds' own
  // comment for why). `escrowReleasedAt: null` in the predicate is
  // belt-and-braces, not load-bearing for correctness: this marker's only
  // reader is the query above, which never matches a Payment whose
  // escrowReleasedAt is already set, so stamping one anyway would be inert
  // either way -- but skipping it keeps the invariant "escrowSweepDeferredAt
  // is only ever non-null on a currently unreleased Payment" true without
  // relying on that downstream fact.
  if (permanentlySkippedIds.length > 0) {
    await prisma.payment.updateMany({
      where: { id: { in: permanentlySkippedIds }, escrowReleasedAt: null },
      data: { escrowSweepDeferredAt: now },
    });
  }

  // PRECEDENCE, stated once here because it is easy to misread as two
  // independent checks: the two branches below are `if` / `else if`, so a
  // call that both filled its release quota AND happened to read a full,
  // scanLimit-sized page getting there reports only the first branch (the
  // ordinary-backlog message). That is deliberate, not an oversight --
  // `releasedCount === ESCROW_RELEASE_SWEEP_LIMIT` on its own already
  // answers "did this call do a full, healthy amount of release work",
  // regardless of how much of the backlog behind it turned out to be
  // permanently stuck, and that is the question an operator needs answered
  // first. The second branch exists for exactly the case the first one does
  // NOT cover: the read came back full and the release quota was NOT
  // filled, i.e. this call could not find enough releasable work in what it
  // read.
  if (releasedCount === ESCROW_RELEASE_SWEEP_LIMIT) {
    // The ordinary backlog case, unchanged in spirit from before ticket 15:
    // this call filled its release quota with genuine releases, so more
    // matured -- and, on the evidence of this call, actually releasable --
    // holds remain for a later call to pick up. Silence here would mean a
    // campaign sitting on a backlog bigger than one sweep can look like
    // nothing is wrong -- the caller sees a normal result, and the only
    // symptom is a campaigner needing to ask for a payout more than once
    // before every matured hold has actually released.
    console.warn(
      `releaseMaturedEscrow: hit the release limit of ${ESCROW_RELEASE_SWEEP_LIMIT}` +
        `${subject ? ` for ${subject.type} ${subject.id}` : ''} -- more matured holds remain ` +
        'and will be picked up by a later call.',
    );
  } else if (matured.length === scanLimit) {
    // Ticket 15's other case: the read came back a full `scanLimit` rows,
    // not the release quota, and this call still did not fill that quota --
    // meaning most or all of what it read was deferred by a permanent guard
    // (a SUSPENDED Campaign/Trip, or an in-flight Refund), not merely "not
    // yet matured". Unlike the warning above, this is not "ask again later
    // and it will drain on its own": the sweep is not reaching the rest of
    // the backlog THIS call, and will not until either the rotation above
    // works through it over further calls or an operator resolves the
    // underlying Suspensions/stuck Refunds sooner. deferredEscrowWatchdog
    // (GET /api/admin/reconcile) lists the individual Payments this is
    // holding up, per subject; this line is the one place that says the
    // sweep itself did not make it past them this call.
    console.warn(
      `releaseMaturedEscrow: read ${matured.length} matured holds` +
        `${subject ? ` for ${subject.type} ${subject.id}` : ''} and released only ${releasedCount} -- ` +
        `${permanentlySkippedCount} were deferred by a permanent guard (a SUSPENDED subject or an ` +
        'in-flight refund). The sweep is not reaching the rest of the backlog this call; see ' +
        'deferredEscrowWatchdog in GET /api/admin/reconcile for the individual Payments this is holding up.',
    );
  }

  return { releasedCount, consideredCount };
}
