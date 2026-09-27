import type { Payout, Prisma, PrismaClient } from '@/generated/prisma/client';
import { campaignBalance, tripBalance, MAX_RUPIAH_AMOUNT, payoutInstructedLegs, payoutCompletedLegs, postTransaction, type LedgerSubject } from './ledger';
import { assertExactlyOnePayoutSubject } from './payout-subject';
import { lockAndLoad, requireNotOwnerAsAdmin, requirePayoutAllowed, type SubjectState } from '@/lib/subject-guard';
import {
  DemoCampaignError,
  BankAccountNotEligibleError,
  InsufficientBalanceError,
  SelfApprovalError,
  InvalidPayoutStatusError,
  PayoutNotFoundError,
  PayoutProofRequiredError,
  ProviderBalanceInsufficientError,
  ProviderBalanceNotRecordedError,
  TwoPersonRuleError,
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
 *
 * The three functions are the whole Payout lifecycle, and the two-person
 * rule is split across two of them: approvePayout refuses the requester,
 * completePayout refuses the approver. Neither does the other's job, and
 * neither contacts a payment provider.
 */

export {
  DemoCampaignError,
  BankAccountNotEligibleError,
  InsufficientBalanceError,
  SelfApprovalError,
  InvalidPayoutStatusError,
  PayoutNotFoundError,
  PayoutProofRequiredError,
  ProviderBalanceInsufficientError,
  ProviderBalanceNotRecordedError,
  TwoPersonRuleError,
};

/**
 * The subject a Payout's money is for, taken from its row and locked, in
 * the caller's transaction.
 *
 * Every operation on an already-created Payout -- approving it, completing
 * it -- has to learn the same three things in the same order, and the order
 * is the point:
 *
 *  1. the row carries exactly one of campaignId/volunteerTripId, so the
 *     money has a single thing it is for (payout-subject.ts guards what
 *     requestPayout wrote; this defends against a row written by anything
 *     else);
 *  2. the Campaign or VolunteerTrip row is locked, and only then read, so
 *     every check the caller makes of its state stays true until it commits
 *     (src/lib/subject-guard.ts is the only code in `src` that issues this
 *     lock, and it is the same lock Cancellation approval takes);
 *  3. the caller's own two judgements, which differ per operation -- who is
 *     acting, and therefore which rules apply to them -- are made on the
 *     state returned, never before it.
 *
 * Returns the subject itself as well as its locked state, because the
 * balance reads and the leg builders both need it and deriving it twice
 * would be the one thing that could drift. `state` is null when the subject
 * row does not exist; what that means belongs to the caller: the foreign
 * key keeps a Campaign alive behind a Payout, and a Trip has no status rule,
 * so both guards are skipped on null in practice.
 */
async function lockPayoutSubject(
  tx: Prisma.TransactionClient,
  payout: Pick<Payout, 'campaignId' | 'volunteerTripId'>,
): Promise<{ subject: LedgerSubject; state: SubjectState | null }> {
  assertExactlyOnePayoutSubject({ campaignId: payout.campaignId, volunteerTripId: payout.volunteerTripId });

  const subject: LedgerSubject = payout.campaignId
    ? { type: 'campaign', campaignId: payout.campaignId }
    : { type: 'trip', tripId: payout.volunteerTripId! };

  return { subject, state: await lockAndLoad(tx, subject, new Date()) };
}

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
 * trip.fundraiserId === requestedById) is the caller's responsibility: the
 * route asks the Capacity judgement before ever reaching here. What
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
 * with proof of transfer -- completePayout, below, which is the other half of
 * the two-person rule and takes the same subject row lock.
 *
 * WHY THE APPROVING ADMIN MUST ALSO HAND OVER THE PROVIDER'S REAL BALANCE
 * (prd-compliance 35; FFI-07 story 53). Everything else this function checks
 * asks whether the Campaign is owed the money; nothing above can ask whether the
 * provider is holding it. That gap is not academic: a ledger only knows what it
 * was told, so a Payout approved against a Campaign Balance the money never
 * reached passes every check here and then fails at the bank. Since no provider
 * this platform talks to exposes a balance API, the figure is a human reading a
 * dashboard, and the only two things the system can do about that are insist it
 * was written down and refuse an approval it says is not covered. It does not
 * claim to verify the reading, because nothing here can.
 */
export async function approvePayout(
  prisma: PrismaClient,
  params: {
    payoutId: string;
    approvedById: string;
    /** Which Payment Provider's dashboard the reading below was taken from. */
    provider: string;
    /** What that dashboard showed, in rupiah, immediately before approving. */
    providerBalance: number;
  },
): Promise<Payout> {
  const { payoutId, approvedById, providerBalance } = params;

  // Checked before the transaction opens, because the reading is a property of
  // the request and not of any row: no amount of reading the database can turn
  // a missing figure into a present one. Nothing below is reached, so nothing is
  // written, and the Payout keeps waiting in DRAFT for an Admin who has looked.
  //
  // WHY IT IS REQUIRED (FFI-07; ADR 0006). Every other check in this function
  // asks whether the CAMPAIGN is owed the money. None of them can ask whether
  // the PROVIDER is holding it, and the difference is the whole risk: a ledger
  // only knows what it was told, so a Payout approved against a Campaign Balance
  // the money never reached would sail through every check here and be paid
  // into a bank account that the transfer then fails against. No provider this
  // platform talks to exposes a balance API, so a human has to read the
  // dashboard and write the number down, and the only thing the system can do
  // about that is insist it happened.
  // A typeof check on the provider as well as the arithmetic on the figure:
  // this is a public seam that both routes call with whatever the body held, so
  // `params.provider.trim()` on a non-string would throw a TypeError that no
  // route can turn into a 422, and the caller would be told the server is
  // broken rather than that it forgot to read the dashboard.
  // The ceiling is the column's, not a policy: Payout.approvedProviderBalance
  // is an Int, so int4's maximum is the largest reading this row can hold. A
  // figure above it is not a dashboard anyone read, and letting it through
  // turns a bad field into a driver error the Admin sees as a 500 rather than
  // as a reading to correct. Same refusal, same 422, and the Payout stays
  // DRAFT -- for the same reason a missing reading does not approve anything:
  // an approval has to be backed by a figure that can be written down.
  const provider = typeof params.provider === 'string' ? params.provider.trim() : '';
  if (
    provider === '' ||
    !Number.isInteger(providerBalance) ||
    providerBalance <= 0 ||
    providerBalance > MAX_RUPIAH_AMOUNT
  ) {
    throw new ProviderBalanceNotRecordedError();
  }

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
    //
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
    // is read nowhere before this lock; lockPayoutSubject reads it under it.
    const { subject, state: subjectState } = await lockPayoutSubject(tx, payout);

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

    // And the other half, which no ledger read can supply: the money has to be
    // at the PROVIDER, not merely owed by the Campaign. A reading that says
    // otherwise leaves the Payout in DRAFT with nothing posted, and the Admin
    // either re-reads the dashboard or waits. Judged after every other check
    // above, so a caller refused for a different reason is told that reason
    // rather than being sent to a dashboard that was never the problem.
    if (payout.amount > providerBalance) {
      throw new ProviderBalanceInsufficientError(payout.amount, providerBalance, provider);
    }

    // Still guarded on status too, even with the campaign lock held: the
    // lock closes the cross-payout balance race above, this closes a second
    // approval of THIS SAME row racing in with a stale read of its own. The
    // loser sees count 0 and never reaches the ledger post below.
    //
    // Kept rather than left to the ledger (prd-compliance 28b), even though
    // the ledger now refuses a transactionId twice on its own: the index
    // would stop the second posting only by aborting this whole transaction
    // and reporting a duplicate, where the claim above reports what actually
    // happened -- another approval got there first -- and stops the loser
    // before it writes anything at all.
    const claimed = await tx.payout.updateMany({
      where: { id: payoutId, status: 'DRAFT' },
      data: {
        status: 'APPROVED',
        approvedById,
        approvedAt: new Date(),
        approvedProvider: provider,
        approvedProviderBalance: providerBalance,
      },
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
    // approved for payout twice. transactionId is keyed on the payout id, and
    // the ledger's claim index
    // (LedgerEntry_transactionId_claim_key, prd-compliance 28b) makes that
    // key a one-shot: this post can never happen twice, on top of (not
    // instead of) the updateMany guard above.
    await postTransaction(
      tx,
      payoutInstructedLegs({ subject, amount: payout.amount }),
      { payoutId: payout.id, transactionId: `payout-instructed-${payout.id}` },
    );
  });

  return prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
}

/**
 * The SECOND Admin records that the money has actually moved: marks the
 * Payout COMPLETED with the proof of transfer attached, and posts the legs
 * that drain PAYOUT_CLEARING and credit the Provider Balance.
 *
 * This is the second half of the two-person rule, and it is enforced here
 * rather than advised in a UI (CONTEXT.md, Payout; ADR 0006; PRD FFI-07).
 * Three separate people must not be able to do this between them:
 *
 *  - the approver, who refused their own completion below. Without the
 *    check, "two people touched this payout" would be satisfiable by one
 *    person touching it twice, and no audit of the row afterwards could
 *    tell the difference -- which is why completedById is recorded, the
 *    same reason approvedById is;
 *  - the Campaign's or Trip's own Fundraiser, refused through
 *    requireNotOwnerAsAdmin on the owner read under the lock. The Fundraiser
 *    is the requester, so they are not the approver on the ordinary path --
 *    meaning "completer is not the approver" alone would let the person who
 *    asked for the money also record having sent it, and CONTEXT.md's Admin
 *    is explicit that they may not act as an Admin over their own subject;
 *  - anyone at all, when the Campaign's status has stopped allowing a
 *    Payout: requirePayoutAllowed, under the same lock as everything else.
 *    A Suspension that lands after approval still holds the Payout, because
 *    the money has been committed to the balance but not yet sent anywhere,
 *    and a Suspended Campaign's money is meant to stay put.
 *
 * WHY THE SAME ROW LOCK AS CANCELLATION. Cancellation approval refuses
 * while no Payout on the Campaign is COMPLETED, and it checks that under
 * the Campaign row lock (src/lib/campaign-lifecycle.ts). Two writers
 * holding no common lock can interleave: cancellation checks (none
 * COMPLETED), completion commits, cancellation writes CANCELLED. The
 * Campaign would then be Cancelled after money had already left it, which
 * is the exact thing the Cancellation rule forbids. Both sides therefore
 * take the lock through the subject guard, the only code in `src` that
 * issues it, and the checks above stay true until each commits.
 *
 * WHY NO PROVIDER CALL, same as approval. The transfer is made by hand in
 * the provider's dashboard, straight to the Fundraiser's verified Bank
 * Account; there is no provider with a disbursement API before launch, and
 * the two-person rule means the money moves on the second Admin's own
 * action rather than a keystroke of the first's (ADR 0006). This function
 * only records what that Admin did.
 *
 * APPROVED ONLY. PROCESSING is a status nothing in this repo writes, so a
 * row in it has no guarantee its instructed legs were posted by this
 * codebase at all, and completing it would post the second half of a
 * movement whose first half cannot be shown to exist. Whoever introduces
 * PROCESSING (a provider webhook, FFI-18) widens this check with it.
 *
 * Generalized over `subject` for the same reason requestPayout and
 * approvePayout are: one money path, two subjects, and the only difference
 * is which row the guard locks.
 */
export async function completePayout(
  prisma: PrismaClient,
  params: {
    payoutId: string;
    completedById: string;
    /** Evidence of the transfer. Non-empty, or there is nothing to record. */
    proofImage: string;
  },
): Promise<Payout> {
  const { payoutId, completedById, proofImage } = params;

  // Checked before the transaction opens, because it is a property of the
  // request and not of any row: a blank proof can never become a good one
  // by reading the database. Nothing below is reached, so nothing is
  // written, and the payout keeps waiting in APPROVED for a second Admin who
  // attaches the evidence.
  if (proofImage.trim() === '') {
    throw new PayoutProofRequiredError();
  }

  await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!payout) {
      throw new PayoutNotFoundError(payoutId);
    }

    // Only the Payout's own row is read before the lock, and every check
    // below needs nothing from the subject: status, approver and amount all
    // live on this row. The subject itself is read nowhere before
    // lockPayoutSubject, the same rule approvePayout follows.
    if (payout.status !== 'APPROVED') {
      throw new InvalidPayoutStatusError(payout.status);
    }

    // The whole two-person rule, before any write: a self-completion leaves
    // the Payout exactly as it was, because it is a refusal and not a
    // decision this Payout has been through. An APPROVED Payout with no
    // recorded approver fails the same check: there is no second person to
    // be different from, and a row that cannot show two people is not a row
    // the two-person rule is satisfied by.
    if (!payout.approvedById || payout.approvedById === completedById) {
      throw new TwoPersonRuleError();
    }

    // Same guard, same order, as approvePayout: the subject this Payout is
    // for, locked before it is read.
    const { state: subjectState } = await lockPayoutSubject(tx, payout);

    // Never the Fundraiser of this Campaign or Trip, whoever approved it.
    if (subjectState) requireNotOwnerAsAdmin(subjectState, completedById);

    // A Suspension or Cancellation committed after approval still holds the
    // Payout (CONTEXT.md, Payout). Judged on the state read under the lock,
    // so a Suspension that committed first is seen. A null state cannot
    // happen for a Campaign, whose row Payout.campaignId's foreign key
    // keeps alive, and a Trip has no status rule; either way it is left to
    // the checks below, as before.
    if (subjectState) requirePayoutAllowed(subjectState);

    // Predicated on the status, exactly as approvePayout is: the lock above
    // serialises operations on the Campaign's money, not two admins racing
    // for this one row, and this is what makes the loser of that race see
    // count 0 instead of a second COMPLETED and a second set of legs.
    const claimed = await tx.payout.updateMany({
      where: { id: payoutId, status: 'APPROVED' },
      data: {
        status: 'COMPLETED',
        completedById,
        completedAt: new Date(),
        proofImage: proofImage.trim(),
      },
    });
    if (claimed.count === 0) {
      // payout.status above is the pre-update read and is now stale; some
      // other write got here first. The message says so rather than
      // repeating a status that may no longer be true.
      throw new InvalidPayoutStatusError('unknown (changed concurrently)', 'lost the completion race');
    }

    // Posted at completion, in the same transaction as the status write:
    // a COMPLETED Payout with the money still in PAYOUT_CLEARING would say
    // the transfer happened while the books still had it in flight, and
    // PAYOUT_CLEARING would never drain. transactionId is keyed on the
    // payout id, so this post is idempotent on top of (not instead of) the
    // updateMany guard above.
    await postTransaction(
      tx,
      payoutCompletedLegs({ amount: payout.amount }),
      { payoutId: payout.id, transactionId: `payout-completed-${payout.id}` },
    );
  });

  return prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
}
