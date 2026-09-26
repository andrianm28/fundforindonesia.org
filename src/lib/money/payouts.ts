import type { Payout, Prisma, PrismaClient } from '@/generated/prisma/client';
import { campaignBalance, tripBalance, payoutInstructedLegs, postTransaction, type LedgerSubject } from './ledger';
import { assertExactlyOnePayoutSubject } from './payout-subject';
import { lockAndLoad, requireNotOwnerAsAdmin, requirePayoutAllowed } from '@/lib/subject-guard';
import {
  DemoCampaignError,
  BankAccountNotEligibleError,
  InsufficientBalanceError,
  SelfApprovalError,
  InvalidPayoutStatusError,
  PayoutNotFoundError,
} from './errors';

/**
 * Payout: request, approve, release.
 *
 * Ported from the FFI repo's two-person disbursement control
 * (packages/db/src/schema/disbursement-requests.ts:40-47). Money leaves the
 * platform through exactly one door -- this file -- the same way the webhook
 * (task M5) is the only door it comes in through.
 *
 * This task does not implement a submit step, so DRAFT -- what requestPayout
 * creates -- is the only status a payout is ever in before approval. SUBMITTED
 * stays in the schema's enum for a future submit flow; nothing here produces
 * it, and approvePayout does not accept it.
 */

export {
  DemoCampaignError,
  BankAccountNotEligibleError,
  InsufficientBalanceError,
  SelfApprovalError,
  InvalidPayoutStatusError,
  PayoutNotFoundError,
};

/**
 * The owning Fundraiser or Campaign creator requests a payout. Creates a
 * DRAFT and posts nothing to the ledger -- a request is not yet a movement
 * of money, only a proposal to make one. This function takes a
 * `Prisma.TransactionClient` because its caller (the route) wraps it in a
 * single `prisma.$transaction`; nothing here does external I/O, so there is
 * no reason to split it the way approval is split below.
 *
 * Generalized over `subject: LedgerSubject` rather than forked into a
 * Trip-scoped sibling: the isDemo check only applies to `subject.type ===
 * 'campaign'` (VolunteerTrip has no isDemo field and no equivalent), and the
 * balance read/subject FK branch on subject.type everywhere else. Every
 * other check -- bank account ownership and verification, the balance cap --
 * applies identically to both subjects.
 *
 * Ownership of the subject itself (campaign.creatorId === requestedById, or
 * trip.fundraiserId === requestedById) is the caller's responsibility:
 * withRoleCheck only proves "a CAMPAIGN_CREATOR-ranked user", not "this
 * subject's owner", so the route checks that before ever reaching here. What
 * this function owns is the destination account: `bankAccount.ownerId` must
 * equal `requestedById` too.
 *
 * Nothing is reserved against the balance here -- two DRAFT requests can be
 * created for more than the subject has. That is deliberate: the balance is
 * only ever spent at approval, and approvePayout is what actually closes the
 * "satisfiable twice" gap, under a lock, at the moment money would really
 * move.
 */
export async function requestPayout(
  tx: Prisma.TransactionClient,
  params: {
    subject: LedgerSubject;
    requestedById: string;
    bankAccountId: string;
    amount: number;
    description: string;
  },
): Promise<Payout> {
  const { subject, requestedById, bankAccountId, amount, description } = params;

  // The subject is locked, then read, before anything else: its state is
  // what the checks below judge (src/lib/subject-guard.ts).
  const subjectState = await lockAndLoad(tx, subject, new Date());

  // Checked before the bank account and the balance -- a demo campaign has
  // no ledger balance either, so InsufficientBalanceError would already stop
  // this -- but that message reads as "the money isn't here yet", which
  // sends whoever sees it looking for a shortfall that does not exist. A
  // VolunteerTrip has no isDemo field and no equivalent concept, so for a
  // trip subject isDemo is always false.
  if (subjectState?.isDemo) {
    throw new DemoCampaignError();
  }

  // Only a Campaign that is effectively Active, Expired or Completed may pay
  // out (CONTEXT.md, Payout); a Trip keeps its rule of today. Judged on the
  // state read under the lock, so a Suspension committed before this
  // transaction took it is seen. A missing subject (null) is left to the
  // checks below, as before: the route answers 404 before reaching here,
  // and Payout.campaignId's foreign key refuses a Payout for a Campaign
  // that does not exist.
  if (subjectState) requirePayoutAllowed(subjectState);

  const bankAccount = await tx.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount || bankAccount.ownerId !== requestedById || !bankAccount.verifiedAt) {
    throw new BankAccountNotEligibleError();
  }

  // Never against Campaign.collectedAmount or any denormalized figure: this
  // figure counts lifetime donations and knows nothing about escrow,
  // refunds, or money already instructed out. Paying against it is how the
  // same money leaves twice. campaignBalance/tripBalance both derive strictly
  // from the ledger, scoped to this subject's own account -- a Trip subject
  // can never read a Campaign's balance or vice versa, because each function
  // filters on its own FK column.
  const balance =
    subject.type === 'campaign'
      ? await campaignBalance(tx, subject.campaignId)
      : await tripBalance(tx, subject.tripId);
  if (amount > balance) {
    throw new InsufficientBalanceError(amount, balance);
  }

  const subjectFk =
    subject.type === 'campaign'
      ? { campaignId: subject.campaignId, volunteerTripId: null }
      : { campaignId: null, volunteerTripId: subject.tripId };
  assertExactlyOnePayoutSubject(subjectFk);

  return tx.payout.create({
    data: {
      ...subjectFk,
      bankAccountId,
      amount,
      description,
      requestedById,
      status: 'DRAFT',
    },
  });
}

/**
 * ADMIN approves a DRAFT payout: posts the instructed legs and lands on
 * APPROVED. It does NOT contact the payment provider, and it never has.
 *
 * WHY NO PROVIDER CALL. Two reasons, and either alone is sufficient.
 *
 * First, the only provider before launch is Sumopod, which has no
 * disbursement API at all -- SumopodProvider.createPayout throws
 * SumopodNotSupportedError by design. An earlier version of this function
 * called provider.createPayout here, which meant that in production every
 * approval committed its ledger legs and then threw, stranding the payout
 * APPROVED with no providerRef and no way forward. CI never caught it
 * because no test approved a payout with the real adapter.
 *
 * Second, and this outlives Sumopod: the two-person rule says the money
 * moves on the SECOND admin's action, not the first. FFI-07 is explicit that
 * even once a provider with a disbursement API exists, "instruksi ke penyedia
 * baru dikirim setelah Admin kedua mengonfirmasinya". Instructing the
 * provider at approval time would put the transfer on the approving admin's
 * single keystroke, which is exactly the control this rule exists to prevent.
 * See ADR 0006.
 *
 * So approval is one transaction and stops there. The money stops being
 * withdrawable the moment the legs commit, which is what prevents the same
 * balance being paid out twice. A second, different admin then performs the
 * withdrawal by hand in the provider dashboard and marks the payout COMPLETED
 * with proof of transfer -- that endpoint does not exist yet, and building it
 * needs a ledger account for money that has physically left, which the
 * LedgerAccount enum does not have. Until it does, an APPROVED payout is
 * where the flow ends and PAYOUT_CLEARING is never drained; the reconcile
 * report surfaces both as anomalies rather than correcting them.
 */
export async function approvePayout(
  prisma: PrismaClient,
  params: {
    payoutId: string;
    approvedById: string;
  },
): Promise<Payout> {
  const { payoutId, approvedById } = params;

  await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({
      where: { id: payoutId },
      include: { bankAccount: true },
    });
    if (!payout) {
      throw new PayoutNotFoundError(payoutId);
    }

    // The entire two-person rule, checked before any write: a self-approval
    // attempt leaves the payout completely untouched, because it is an
    // error, not a decision this payout has been through.
    if (payout.requestedById === approvedById) {
      throw new SelfApprovalError('Payout');
    }

    if (payout.status !== 'DRAFT') {
      throw new InvalidPayoutStatusError(payout.status);
    }

    // Re-checked here, not trusted from request time. Nothing in this repo
    // writes a BankAccount after creation except (by hand, outside the app)
    // clearing verifiedAt when one turns out to be fraudulent -- exactly the
    // scenario this exists to catch, in the window between a requester's
    // request and an admin's approval.
    const { bankAccount } = payout;
    if (!bankAccount || bankAccount.ownerId !== payout.requestedById || !bankAccount.verifiedAt) {
      throw new BankAccountNotEligibleError();
    }

    // Which subject this Payout actually belongs to -- exactly one of
    // campaignId/volunteerTripId is set (assertExactlyOnePayoutSubject
    // guards this at creation, in requestPayout above). This branch never
    // hardcodes 'campaign': it is what makes a Trip-linked Payout unable to
    // ever touch CAMPAIGN_BALANCE, and a Campaign-linked one unable to ever
    // touch TRIP_BALANCE, no matter how either was requested.
    assertExactlyOnePayoutSubject({ campaignId: payout.campaignId, volunteerTripId: payout.volunteerTripId });

    const subject: LedgerSubject = payout.campaignId
      ? { type: 'campaign', campaignId: payout.campaignId }
      : { type: 'trip', tripId: payout.volunteerTripId! };

    // The contended resource is the subject's withdrawable BALANCE, not
    // this payout row -- a second, different DRAFT payout against the same
    // subject is a different row entirely and would sail straight past a
    // lock on this one. Locking the Campaign or VolunteerTrip row is what
    // serialises two admins approving two different payouts against the
    // same balance at once. Without it: campaignBalance/tripBalance below
    // is a plain SELECT ... GROUP BY with no row to lock, these
    // transactions run at Postgres's default READ COMMITTED, and two
    // concurrent approvals of two DIFFERENT payouts on the same subject
    // would each read the same pre-spend balance, each pass the check
    // below, and both commit -- the balance would go negative with nothing
    // to stop it, since balances are derived by summing entries, never
    // stored.
    //
    // The checks above read only this Payout's own row. The subject itself
    // is read nowhere before this lock; lockAndLoad reads it under it.
    const subjectState = await lockAndLoad(tx, subject, new Date());

    // Approval is always an Admin act, so it is refused to the Campaign's or
    // the Trip's own Fundraiser, whoever requested it (CONTEXT.md, Capacity).
    // Judged on the owner read under the lock, like approveRefund.
    if (subjectState) requireNotOwnerAsAdmin(subjectState, approvedById);

    // Re-judged here, not trusted from request time: a Suspension or
    // Cancellation committed between the request and this lock refuses the
    // approval, and the Payout stays DRAFT with nothing posted (CONTEXT.md,
    // Payout). A null state cannot happen for a Campaign, whose row
    // Payout.campaignId's foreign key keeps alive, and a Trip has no status
    // rule; either way it is left to the checks below, as before.
    if (subjectState) requirePayoutAllowed(subjectState);

    // Balance can have moved since the request -- a refund, another payout
    // approved first -- and, now that this transaction holds the subject's
    // row lock, this read is guaranteed current for as long as the lock is
    // held.
    const balance =
      subject.type === 'campaign'
        ? await campaignBalance(tx, subject.campaignId)
        : await tripBalance(tx, subject.tripId);
    if (payout.amount > balance) {
      throw new InsufficientBalanceError(payout.amount, balance);
    }

    // Still guarded on status too, even with the campaign lock held: the
    // lock closes the cross-payout balance race above, this closes a second
    // approval of THIS SAME row racing in with a stale read of its own. The
    // loser sees count 0 and never reaches the ledger post below.
    const claimed = await tx.payout.updateMany({
      where: { id: payoutId, status: 'DRAFT' },
      data: { status: 'APPROVED', approvedById, approvedAt: new Date() },
    });
    if (claimed.count === 0) {
      // payout.status above is the pre-update read and is now stale -- some
      // other write got here first, but this function does not re-read to
      // find out what it left behind. The message says so rather than
      // repeating a status that may no longer be true.
      throw new InvalidPayoutStatusError('unknown (changed concurrently)', 'lost the approval race');
    }

    // Posted at approval, not at completion. Money promised to a bank must
    // stop being withdrawable immediately, or the same balance can be
    // approved for payout twice. transactionId is keyed on the payout id so
    // this post can never happen twice, on top of (not instead of) the
    // updateMany guard above.
    await postTransaction(
      tx,
      payoutInstructedLegs({ subject, amount: payout.amount }),
      { payoutId: payout.id, transactionId: `payout-instructed-${payout.id}` },
    );
  });

  return prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
}
