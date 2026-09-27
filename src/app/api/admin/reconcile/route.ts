import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { findUnbalancedTransactions } from '@/lib/money/ledger';
import { DEFERRED_ESCROW_WATCHDOG_DAYS, deferredEscrowWatchdogCutoff } from '@/lib/money/escrow';
import { effectiveStatus, isEscrowReleaseFrozen } from '@/lib/subject-guard';

/**
 * GET /api/admin/reconcile -- ADMIN-only reconciliation report.
 *
 * Reports. Never corrects. A reconciliation job that silently fixes its own
 * findings destroys the evidence of what went wrong, and in a money system
 * that evidence is the only way to learn what broke -- so nothing in this
 * file writes anything.
 *
 * What it surfaces:
 *
 *  - unbalancedTransactions: findUnbalancedTransactions (./ledger.ts). Should
 *    always be empty -- postTransaction refuses to post an unbalanced set of
 *    legs -- so a non-empty result means some write bypassed it entirely.
 *  - negativeBalances: a campaign-scoped account (ESCROW_HOLD or
 *    CAMPAIGN_BALANCE) whose credits-minus-debits has gone below zero.
 *    releaseMaturedEscrow (./escrow.ts) deliberately does NOT cap a
 *    release against the campaign's shared ESCROW_HOLD balance -- see that
 *    function's own comment for why a cap there would be wrong, not merely
 *    absent. What is supposed to keep this account non-negative is that a
 *    refund's freeze (refundRequestedLegs, ./ledger.ts) only ever debits the
 *    source account the refund's own NET share -- the Provider/Platform Fee
 *    portion is split out at freeze time and never touches this account at
 *    all -- so there is no routine over-draw here to correct; only a
 *    genuine settlement-time shortfall (refundApprovedLegs, real pool
 *    insolvency, e.g. a Payout already spent past this refund's share)
 *    ever credits this account back, and the balance checks in
 *    ./payouts.ts for CAMPAIGN_BALANCE; this is what would catch it if one
 *    of those was ever wrong.
 *  - preLedger / mismatches: both compare Campaign.collectedAmount against
 *    what the ledger says this campaign has ever been credited, but they are
 *    reported separately because they mean different things. A campaign with
 *    collectedAmount > 0 and NO ledger entries at all -- e.g. one funded
 *    entirely through /api/balance/donate (the wallet flow), which posts
 *    nothing to the ledger -- predates the money layer by construction, not
 *    by a date this file would have to keep in sync; every one of those goes
 *    to `preLedger`, a known, expected bucket. A campaign that DOES have
 *    ledger entries and still disagrees with collectedAmount is the real
 *    finding, in `mismatches`. Per ledger.ts's doc comment, the ledger is
 *    right when the two disagree -- this reports the gap, it does not touch
 *    collectedAmount to close it. `caveat` carries the preLedger explanation
 *    in the payload itself so it travels with the response. Campaigns with
 *    `isDemo` (task M9) are excluded from BOTH buckets before this
 *    comparison ever runs -- their collectedAmount is fixture data with no
 *    ledger behind it by design, and this report should never spend a line
 *    on that.
 *  - strandedEscrow: a Payment with `escrowReleasedAt` set (releaseMaturedEscrow,
 *    ./escrow.ts, considers it permanently finished) whose credited net still
 *    does not add up against what has actually left ESCROW_HOLD on its
 *    behalf -- either released directly, or debited by a refund against it.
 *    Should always be empty; it exists as the safety net for the exact class
 *    of bug fixed in escrow.ts (stamping a payment "done" while a refund
 *    against it was still in flight, then that refund resolving in a way the
 *    stamp never gets to react to) recurring by some other route -- a human
 *    sees it here instead of the money simply going quiet.
 *  - deferredEscrowWatchdog: a Payment still PAID, with `escrowReleasedAt`
 *    still null, whose `escrowReleaseAt` matured more than
 *    DEFERRED_ESCROW_WATCHDOG_DAYS (./escrow.ts) days ago. releaseMaturedEscrow
 *    defers a payment entirely, correctly, while a refund against it is
 *    REQUESTED or PROCESSING -- but a refund left stuck open in that state
 *    defers the payment's escrow indefinitely, and strandedEscrow above
 *    cannot see it: that check only ever looks at payments where
 *    escrowReleasedAt is already set, which a deferred payment's never is.
 *    Reported, not corrected, like everything else in this file -- a human
 *    resolves the stuck refund, which lets a later sweep release the payment
 *    on its own.
 *    The other known cause is a Suspension: releaseMaturedEscrow leaves a
 *    Suspended Campaign's matured money in Escrow Hold on purpose (CONTEXT.md,
 *    Escrow Hold) until the Suspension is lifted. Those payments are still
 *    listed, because an Admin wants to see money a Suspension holds, but each carries
 *    `cause: 'SUSPENDED'` so it does not read as a stuck sweep. The rule is
 *    the subject guard's own isEscrowReleaseFrozen, asked without a row lock
 *    since this report only reads. An entry with no `cause` is unexplained
 *    exactly as before; Trip entries never carry one (ADR 0014).
 *  - stuckPayouts: two payout states that are work rather than incidents --
 *    see the comments there.
 *  - pendingRefunds: every Refund whose status is REQUESTED, Campaign-or-Trip
 *    both in one combined list -- the only place in this codebase a REQUESTED
 *    Refund becomes discoverable after it's created.
 *  - pendingManualContributions: every Manual Contribution still waiting for
 *    the second Admin (prd-compliance 34), Campaign-or-Program both. The
 *    approval queue for the two-person rule on money that arrived outside the
 *    gateway. Also folded into `mismatches` above: a contribution's approval
 *    moves collectedAmount and the ledger in one transaction, so comparing
 *    collectedAmount against settled net and provider fee alone would report
 *    every one of them as a permanent discrepancy.
 *  - orphanedCancelledRegistrationPayments: a PAID Trip Payment whose
 *    Registration is CANCELLED with no live Refund against it -- the safety
 *    net for the settlement webhook's own auto-refund failing silently.
 */
export const GET = withAssignmentCheck(Assignment.ADMIN, async (_req: NextRequest) => {
  const report = await prisma.$transaction(async (tx) => {
    const reportNow = new Date();
    const unbalancedTransactions = await findUnbalancedTransactions(tx);

    // One pass over every campaign-scoped ledger entry, bucketed by
    // campaign + account and netted by direction -- the same
    // credits-minus-debits shape as ledger.ts's accountBalance, computed for
    // every campaign at once instead of one at a time.
    const balanceRows = await tx.ledgerEntry.groupBy({
      by: ['campaignId', 'account', 'direction'],
      where: { campaignId: { not: null } },
      _sum: { amount: true },
    });

    const balances = new Map<string, Map<string, number>>();
    for (const row of balanceRows) {
      const campaignId = row.campaignId as string;
      const perCampaign = balances.get(campaignId) ?? new Map<string, number>();
      const signed = row.direction === 'CREDIT' ? (row._sum.amount ?? 0) : -(row._sum.amount ?? 0);
      perCampaign.set(row.account, (perCampaign.get(row.account) ?? 0) + signed);
      balances.set(campaignId, perCampaign);
    }

    // Array.from rather than a direct for-of over the Map: this repo's
    // tsconfig target predates downlevel iteration, same reason
    // findUnbalancedTransactions (./ledger.ts) does the same.
    const negativeBalances: Array<{ campaignId: string; account: string; balance: number }> = [];
    for (const [campaignId, perCampaign] of Array.from(balances.entries())) {
      for (const account of ['ESCROW_HOLD', 'CAMPAIGN_BALANCE'] as const) {
        const balance = perCampaign.get(account) ?? 0;
        if (balance < 0) negativeBalances.push({ campaignId, account, balance });
      }
    }

    // Trip-scoped sibling of the negativeBalances check above -- same
    // shape, same reasoning, grouped by volunteerTripId instead of
    // campaignId, checking ESCROW_HOLD/TRIP_BALANCE instead of
    // ESCROW_HOLD/CAMPAIGN_BALANCE.
    const tripBalanceRows = await tx.ledgerEntry.groupBy({
      by: ['volunteerTripId', 'account', 'direction'],
      where: { volunteerTripId: { not: null } },
      _sum: { amount: true },
    });

    const tripBalances = new Map<string, Map<string, number>>();
    for (const row of tripBalanceRows) {
      const volunteerTripId = row.volunteerTripId as string;
      const perTrip = tripBalances.get(volunteerTripId) ?? new Map<string, number>();
      const signed = row.direction === 'CREDIT' ? (row._sum.amount ?? 0) : -(row._sum.amount ?? 0);
      perTrip.set(row.account, (perTrip.get(row.account) ?? 0) + signed);
      tripBalances.set(volunteerTripId, perTrip);
    }

    const tripNegativeBalances: Array<{ volunteerTripId: string; account: string; balance: number }> = [];
    for (const [volunteerTripId, perTrip] of Array.from(tripBalances.entries())) {
      for (const account of ['ESCROW_HOLD', 'TRIP_BALANCE'] as const) {
        const balance = perTrip.get(account) ?? 0;
        if (balance < 0) tripNegativeBalances.push({ volunteerTripId, account, balance });
      }
    }

    // Campaign.collectedAmount is written, in the same transaction as the
    // ledger, as the payment's GROSS amount (see the webhook route). The
    // ledger instead credits ESCROW_HOLD the NET and PROVIDER_FEE the fee
    // (paymentSettledLegs, ./ledger.ts) -- PROVIDER_FEE is a platform-level
    // account and carries no campaignId of its own (CAMPAIGN_SCOPED,
    // ./ledger.ts), so its fee entries are attributed back to a campaign
    // here, for this report only, via the Payment/Donation each entry
    // names. net-ever-credited + fee reconstructs the gross the ledger saw
    // for this campaign; that is what collectedAmount is compared against.
    const escrowCreditRows = await tx.ledgerEntry.groupBy({
      by: ['campaignId'],
      where: { account: 'ESCROW_HOLD', direction: 'CREDIT', campaignId: { not: null } },
      _sum: { amount: true },
    });
    const netEverCreditedByCampaign = new Map<string, number>(
      escrowCreditRows.map((r) => [r.campaignId as string, r._sum.amount ?? 0]),
    );

    const providerFeeEntries = await tx.ledgerEntry.findMany({
      where: { account: 'PROVIDER_FEE', direction: 'CREDIT', paymentId: { not: null } },
      select: { amount: true, paymentId: true },
    });
    const feePaymentIds = Array.from(new Set(providerFeeEntries.map((e) => e.paymentId as string)));
    const feePayments = feePaymentIds.length
      ? await tx.payment.findMany({
          where: { id: { in: feePaymentIds } },
          select: { id: true, donation: { select: { campaignId: true } } },
        })
      : [];
    // A Registration-linked Payment's PROVIDER_FEE leg has no campaign to
    // attribute to -- filtered out here rather than crashing on p.donation
    // being null; feeByCampaign is campaign-only by construction.
    const campaignIdByPaymentId = new Map(
      feePayments.filter((p) => p.donation != null).map((p) => [p.id, p.donation!.campaignId]),
    );
    const feeByCampaign = new Map<string, number>();
    for (const entry of providerFeeEntries) {
      const campaignId = campaignIdByPaymentId.get(entry.paymentId as string);
      if (!campaignId) continue;
      feeByCampaign.set(campaignId, (feeByCampaign.get(campaignId) ?? 0) + entry.amount);
    }

    // Money that arrived outside the gateway (CONTEXT.md, Manual
    // Contribution; prd-compliance 34) is a third thing the gross a Campaign
    // has been credited with can be made of, alongside the settled net and
    // its provider fee. Its approval increments collectedAmount in the same
    // transaction as the ledger, so leaving it out here would report every
    // Manual Contribution as a permanent mismatch.
    //
    // Credits minus debits, keyed on the CAMPAIGN_BALANCE account alone, so a
    // reversed contribution nets back to zero and a Program's money -- which
    // carries no campaignId and is never reconciled against a Campaign --
    // cannot be counted here at all.
    const manualRows = await tx.ledgerEntry.groupBy({
      by: ['campaignId', 'direction'],
      where: {
        account: 'CAMPAIGN_BALANCE',
        campaignId: { not: null },
        manualContributionId: { not: null },
      },
      _sum: { amount: true },
    });
    const manualByCampaign = new Map<string, number>();
    for (const row of manualRows) {
      const campaignId = row.campaignId as string;
      const signed = row.direction === 'CREDIT' ? (row._sum.amount ?? 0) : -(row._sum.amount ?? 0);
      manualByCampaign.set(campaignId, (manualByCampaign.get(campaignId) ?? 0) + signed);
    }

    // Every recorded Manual Contribution still waiting for a second Admin --
    // the two-person rule's work queue. Nothing else in this report makes a
    // PENDING one discoverable, and a rule nobody can find the work for is a
    // rule that quietly stops happening.
    const pendingManualContributionRows = await tx.manualContribution.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        campaignId: true,
        programId: true,
        amount: true,
        proofReference: true,
        recordedById: true,
        createdAt: true,
      },
    });

    const pendingManualContributions = pendingManualContributionRows.map((m) => ({
      manualContributionId: m.id,
      campaignId: m.campaignId,
      programId: m.programId,
      amount: m.amount,
      proofReference: m.proofReference,
      recordedById: m.recordedById,
      createdAt: m.createdAt,
    }));

    const campaigns = await tx.campaign.findMany({
      select: { id: true, title: true, collectedAmount: true, isDemo: true },
    });

    type CollectedAmountRow = {
      campaignId: string;
      campaignTitle: string;
      collectedAmount: number;
      ledgerAmount: number;
      difference: number;
    };
    const preLedger: CollectedAmountRow[] = [];
    const mismatches: CollectedAmountRow[] = [];
    for (const campaign of campaigns) {
      // Demo campaigns (task M9) are excluded here, belt-and-braces, on top
      // of the "no ledger activity at all" partition below -- every one of
      // them already falls into that bucket, but this does not rely on that
      // holding forever. Their collectedAmount is fixture data with no
      // ledger behind it BY DESIGN, not a fault this report should ever
      // flag: skipping them here is why preLedger is expected to be empty on
      // this database, not merely small.
      if (campaign.isDemo) continue;

      const ledgerAmount =
        (netEverCreditedByCampaign.get(campaign.id) ?? 0) +
        (feeByCampaign.get(campaign.id) ?? 0) +
        (manualByCampaign.get(campaign.id) ?? 0);
      if (ledgerAmount === campaign.collectedAmount) continue;

      const row: CollectedAmountRow = {
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        collectedAmount: campaign.collectedAmount,
        ledgerAmount,
        difference: campaign.collectedAmount - ledgerAmount,
      };
      // "No ledger entries at all" checked directly, not inferred from
      // ledgerAmount being 0 -- a campaign that DOES have ledger activity but
      // nets to exactly 0 (fully refunded, say) must still land in
      // `mismatches` if collectedAmount disagrees, not be waved through as
      // pre-ledger.
      const hasLedgerActivity =
        balances.has(campaign.id) ||
        feeByCampaign.has(campaign.id) ||
        (manualByCampaign.get(campaign.id) ?? 0) !== 0;
      if (!hasLedgerActivity) {
        preLedger.push(row);
      } else {
        mismatches.push(row);
      }
    }

    // Every payment releaseMaturedEscrow (./escrow.ts) considers permanently
    // finished. For each, "what's left of its credited net" is computed two
    // independent ways and compared: the net it originally credited to
    // ESCROW_HOLD (Payment.amount - Payment.providerFee, no query needed --
    // these are the same two fields the release itself reads) minus (a) what
    // has actually been released on its behalf, and (b) what a refund
    // against it has actually debited. A nonzero remainder means this
    // payment's own money is sitting in ESCROW_HOLD with nothing left able
    // to ever move it, because escrowReleasedAt already took it out of the
    // sweep's predicate.
    const releasedPayments = await tx.payment.findMany({
      where: { escrowReleasedAt: { not: null } },
      select: {
        id: true,
        amount: true,
        providerFee: true,
        donationId: true,
        registrationId: true,
        donation: { select: { campaignId: true } },
        registration: { select: { batch: { select: { tripId: true } } } },
      },
    });
    const releasedPaymentIds = releasedPayments.map((p) => p.id);

    // (a) What escrow-release actually posted for each payment. Its DEBIT
    // ESCROW_HOLD leg carries paymentId (postTransaction stamps it from
    // PostOptions.paymentId, escrow.ts's own release call), so this is a
    // direct sum, not an attribution.
    const releasedLedgerRows = releasedPaymentIds.length
      ? await tx.ledgerEntry.groupBy({
          by: ['paymentId'],
          where: { account: 'ESCROW_HOLD', direction: 'DEBIT', paymentId: { in: releasedPaymentIds } },
          _sum: { amount: true },
        })
      : [];
    const releasedAmountByPayment = new Map<string, number>(
      releasedLedgerRows.map((r) => [r.paymentId as string, r._sum.amount ?? 0]),
    );

    // (b) What a refund against each payment has actually debited. A
    // refund's ESCROW_HOLD debit carries refundId, not paymentId
    // (refundRequestedLegs/refundApprovedLegs, ./ledger.ts, are posted with
    // PostOptions.refundId, never paymentId) -- so, the same way
    // PROVIDER_FEE was attributed to a campaign above, this is joined
    // through Refund.paymentId rather than read off the ledger entry itself.
    const refundsOnReleasedPayments = releasedPaymentIds.length
      ? await tx.refund.findMany({
          where: { paymentId: { in: releasedPaymentIds } },
          select: { id: true, paymentId: true },
        })
      : [];
    const paymentIdByRefundId = new Map(refundsOnReleasedPayments.map((r) => [r.id, r.paymentId]));
    const refundIds = refundsOnReleasedPayments.map((r) => r.id);
    const refundDebitRows = refundIds.length
      ? await tx.ledgerEntry.groupBy({
          by: ['refundId'],
          where: { account: 'ESCROW_HOLD', direction: 'DEBIT', refundId: { in: refundIds } },
          _sum: { amount: true },
        })
      : [];
    const refundedAmountByPayment = new Map<string, number>();
    for (const row of refundDebitRows) {
      const paymentId = paymentIdByRefundId.get(row.refundId as string);
      if (!paymentId) continue;
      refundedAmountByPayment.set(paymentId, (refundedAmountByPayment.get(paymentId) ?? 0) + (row._sum.amount ?? 0));
    }

    // No production path creates a Payment with neither donationId nor
    // registrationId set (assertExactlyOnePaymentSubject guards both create
    // sites) -- but reconcile is exactly the tool an admin would reach for
    // to find such an anomalous row, so it must not throw on one either.
    const subjectlessPayments: Array<{ paymentId: string; context: 'strandedEscrow' | 'deferredEscrowWatchdog' | 'pendingRefunds' }> = [];

    const strandedEscrow: Array<{
      paymentId: string;
      campaignId: string;
      creditedNet: number;
      releasedAmount: number;
      refundedAmount: number;
      residual: number;
    }> = [];
    const tripStrandedEscrow: Array<{
      paymentId: string;
      volunteerTripId: string;
      creditedNet: number;
      releasedAmount: number;
      refundedAmount: number;
      residual: number;
    }> = [];
    for (const payment of releasedPayments) {
      const creditedNet = payment.amount - payment.providerFee;
      const releasedAmount = releasedAmountByPayment.get(payment.id) ?? 0;
      const refundedAmount = refundedAmountByPayment.get(payment.id) ?? 0;
      const residual = creditedNet - releasedAmount - refundedAmount;
      if (residual === 0) continue;

      if (payment.donationId != null) {
        strandedEscrow.push({
          paymentId: payment.id,
          campaignId: payment.donation!.campaignId,
          creditedNet,
          releasedAmount,
          refundedAmount,
          residual,
        });
      } else if (payment.registrationId != null) {
        tripStrandedEscrow.push({
          paymentId: payment.id,
          volunteerTripId: payment.registration!.batch.tripId,
          creditedNet,
          releasedAmount,
          refundedAmount,
          residual,
        });
      } else {
        subjectlessPayments.push({ paymentId: payment.id, context: 'strandedEscrow' });
      }
    }

    // Payments whose escrow hold matured long enough ago that "still
    // deferred by an in-flight refund" stops being the likely explanation --
    // see the module doc comment above and DEFERRED_ESCROW_WATCHDOG_DAYS
    // (./escrow.ts) for why this window, not zero, is the trigger. Refund
    // status is included so a human can immediately see whether this is a
    // refund stuck in REQUESTED/PROCESSING (the expected cause) or something
    // else entirely (no in-flight refund at all, which would be new) -- unless
    // the Campaign is Suspended, the one case where money is held with no
    // refund at all by design; that entry is labelled `cause: 'SUSPENDED'`.
    const deferredEscrowCandidates = await tx.payment.findMany({
      where: {
        status: 'PAID',
        escrowReleasedAt: null,
        escrowReleaseAt: { lte: deferredEscrowWatchdogCutoff() },
      },
      select: {
        id: true,
        escrowReleaseAt: true,
        donationId: true,
        registrationId: true,
        donation: {
          select: {
            campaignId: true,
            campaign: { select: { lifecycleStatus: true, deadline: true } },
          },
        },
        registration: { select: { batch: { select: { tripId: true } } } },
        refunds: { select: { id: true, status: true } },
      },
    });

    const deferredEscrowWatchdog: Array<{
      paymentId: string;
      campaignId: string;
      escrowReleaseAt: Date | null;
      refunds: Array<{ refundId: string; status: string }>;
      cause?: 'SUSPENDED';
    }> = [];
    const tripDeferredEscrowWatchdog: Array<{
      paymentId: string;
      volunteerTripId: string;
      escrowReleaseAt: Date | null;
      refunds: Array<{ refundId: string; status: string }>;
    }> = [];
    for (const payment of deferredEscrowCandidates) {
      const row = {
        paymentId: payment.id,
        escrowReleaseAt: payment.escrowReleaseAt,
        refunds: payment.refunds.map((r) => ({ refundId: r.id, status: r.status })),
      };
      if (payment.donationId != null) {
        const { campaignId, campaign } = payment.donation!;
        const frozen = isEscrowReleaseFrozen({
          kind: 'campaign',
          effectiveStatus: effectiveStatus(campaign, reportNow),
        });
        deferredEscrowWatchdog.push({ ...row, campaignId, ...(frozen ? { cause: 'SUSPENDED' as const } : {}) });
      } else if (payment.registrationId != null) {
        tripDeferredEscrowWatchdog.push({ ...row, volunteerTripId: payment.registration!.batch.tripId });
      } else {
        subjectlessPayments.push({ paymentId: payment.id, context: 'deferredEscrowWatchdog' });
      }
    }

    // Every REQUESTED Refund, Campaign-or-Trip both, in one combined list --
    // an approval work queue has no reason to be split by subject the way a
    // balance check does. Nothing else in this codebase currently makes a
    // REQUESTED Refund discoverable after it's created; this is the only
    // place an Admin can find one to act on.
    const pendingRefundRows = await tx.refund.findMany({
      where: { status: 'REQUESTED' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        paymentId: true,
        amount: true,
        reason: true,
        requestedById: true,
        createdAt: true,
        payment: {
          select: {
            donationId: true,
            registrationId: true,
            donation: { select: { campaignId: true } },
            registration: { select: { batch: { select: { tripId: true } } } },
          },
        },
      },
    });

    const pendingRefunds: Array<{
      refundId: string;
      paymentId: string;
      amount: number;
      reason: string;
      requestedById: string;
      createdAt: Date;
      campaignId: string | null;
      volunteerTripId: string | null;
    }> = [];
    for (const r of pendingRefundRows) {
      const base = { refundId: r.id, paymentId: r.paymentId, amount: r.amount, reason: r.reason, requestedById: r.requestedById, createdAt: r.createdAt };
      if (r.payment?.donationId != null) {
        pendingRefunds.push({ ...base, campaignId: r.payment.donation!.campaignId, volunteerTripId: null });
      } else if (r.payment?.registrationId != null) {
        pendingRefunds.push({ ...base, campaignId: null, volunteerTripId: r.payment.registration!.batch.tripId });
      } else {
        subjectlessPayments.push({ paymentId: r.paymentId, context: 'pendingRefunds' });
      }
    }

    // Task-level safety net for the settlement webhook's auto-refund (see
    // that route's own comment): if createRefund itself throws there, the
    // webhook logs and moves on rather than failing the provider's request,
    // which means the Payment stays PAID with no Refund ever created. Nothing
    // else in this report can find that case -- strandedEscrow/
    // deferredEscrowWatchdog both only look at Payments some in-flight Refund
    // is deferring, and none exists here to defer anything. A PAID Trip
    // Payment whose Registration is CANCELLED with no live Refund against it
    // is exactly that failure, surfaced instead of silently releasing at
    // maturity with no record anything went wrong.
    const paidTripPayments = await tx.payment.findMany({
      where: { status: 'PAID', registrationId: { not: null } },
      select: {
        id: true,
        registrationId: true,
        registration: { select: { status: true, batch: { select: { tripId: true } } } },
        refunds: { select: { id: true, status: true } },
      },
    });

    const orphanedCancelledRegistrationPayments: Array<{
      paymentId: string;
      registrationId: string;
      volunteerTripId: string;
    }> = [];
    for (const payment of paidTripPayments) {
      if (payment.registration?.status !== 'CANCELLED') continue;
      const hasLiveRefund = payment.refunds.some((r) => r.status !== 'REJECTED' && r.status !== 'FAILED');
      if (hasLiveRefund) continue;
      orphanedCancelledRegistrationPayments.push({
        paymentId: payment.id,
        registrationId: payment.registrationId!,
        volunteerTripId: payment.registration.batch.tripId,
      });
    }

    // Two payout states an Admin still has work to do -- see the module doc
    // comment above and the notes on each key below.
    const processingPayouts = await tx.payout.findMany({
      where: { status: 'PROCESSING' },
      select: { id: true, campaignId: true, volunteerTripId: true, amount: true, providerRef: true, approvedAt: true },
    });
    const approvedWithoutProviderRef = await tx.payout.findMany({
      where: { status: 'APPROVED', providerRef: null },
      select: { id: true, campaignId: true, volunteerTripId: true, amount: true, approvedAt: true },
    });

    return {
      generatedAt: reportNow.toISOString(),
      unbalancedTransactions,
      negativeBalances,
      tripNegativeBalances,
      preLedger,
      caveat:
        'preLedger campaigns have collectedAmount > 0 but no ledger entries at all -- they ' +
        'predate the money layer (e.g. funded via /api/balance/donate, which never posts to ' +
        'the ledger). They are expected, not incidents. Campaigns with isDemo=true are excluded ' +
        'from both preLedger and mismatches entirely, above, for the same reason. mismatches are ' +
        'campaigns that DO have ledger activity and still disagree with collectedAmount -- those are the real findings.' +
        ' tripDeferredEscrowWatchdog now means the same as deferredEscrowWatchdog -- a Trip payout flow exists ' +
        '(POST /api/volunteer-trips/[slug]/payouts releases matured Trip escrow the same way Campaign payout does), ' +
        'so a non-empty result here is a real incident, not an expected gap.' +
        " deferredEscrowWatchdog entries with cause 'SUSPENDED' belong to a Suspended Campaign, whose matured " +
        'money is kept in Escrow Hold on purpose until the Suspension is lifted -- not a stuck sweep.',
      mismatches,
      strandedEscrow,
      tripStrandedEscrow,
      deferredEscrowWatchdog,
      tripDeferredEscrowWatchdog,
      // Should always be empty; anything here means a Payment reached
      // settlement/release code with neither donationId nor registrationId
      // set, which assertExactlyOnePaymentSubject should have prevented at
      // creation -- treat a non-empty result as a data-integrity incident.
      subjectlessPayments,
      pendingRefunds,
      pendingManualContributions,
      orphanedCancelledRegistrationPayments,
      stuckPayouts: {
        // Nothing in this codebase writes PROCESSING today -- approval stops
        // at APPROVED, and a second Admin then completes the Payout by hand
        // (completePayout, ./payouts.ts), which only ever writes COMPLETED.
        // Kept because that provider is planned (FFI-18) and because any row
        // appearing here now would mean something wrote a status no code path
        // should be writing. completePayout refuses a PROCESSING row for the
        // same reason: it cannot show that the instructed legs were ever
        // posted, so completing it would post the second half of a movement
        // whose first half is unproven.
        processing: processingPayouts.map((p) => ({
          payoutId: p.id,
          campaignId: p.campaignId,
          volunteerTripId: p.volunteerTripId,
          amount: p.amount,
          providerRef: p.providerRef,
          approvedAt: p.approvedAt,
        })),
        // The work queue for the second Admin: "approved, money already
        // committed out of CAMPAIGN_BALANCE, waiting for someone to actually
        // transfer it and record proof" (POST .../payouts/[id]/complete). A
        // row lingering here long after the transfer happened is a real
        // incident -- the money is committed out of the balance and nobody
        // has proved where it went.
        //
        // A COMPLETED payout cannot appear here: the query is on status
        // APPROVED, so a transfer the second Admin has recorded stops being
        // outstanding work. That is the whole of what completion changes in
        // this report. There is no second list of PAYOUT_CLEARING balances to
        // keep honest either, because completion drains that account in the
        // same transaction (payoutCompletedLegs, ./ledger.ts).
        approvedWithoutProviderRef: approvedWithoutProviderRef.map((p) => ({
          payoutId: p.id,
          campaignId: p.campaignId,
          volunteerTripId: p.volunteerTripId,
          amount: p.amount,
          approvedAt: p.approvedAt,
        })),
      },
    };
  });

  return NextResponse.json(report);
});
