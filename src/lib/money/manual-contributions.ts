import type { ManualContribution, Prisma, PrismaClient } from '@/generated/prisma/client';
import {
  campaignBalance,
  manualContributionReceivedLegs,
  manualContributionReversedLegs,
  MAX_RUPIAH_AMOUNT,
  postTransaction,
  programBalance,
  type ManualContributionSubject,
} from './ledger';
import { lockAndLoad, requireNotOwnerAsAdmin, type SubjectState } from '@/lib/subject-guard';
import { OwnSubjectConflictError } from '@/lib/capacity';
import { currentSandboxStamp, sandboxModeOf } from './sandbox-mode';
import {
  DemoCampaignError,
  ManualContributionAlreadySpentError,
  ManualContributionAmountError,
  ManualContributionInputError,
  ManualContributionNotApprovedError,
  ManualContributionNotFoundError,
  ManualContributionNotPendingError,
  ManualContributionProofRequiredError,
  ManualContributionTargetError,
  SelfApprovalError,
} from './errors';

/**
 * Manual Contribution (prd-compliance 34; PRD FFI-07c; CONTEXT.md, Manual
 * Contribution): money that arrives outside the payment gateway -- a bank
 * transfer, cash handed over at an event.
 *
 * The same two-person rule as a Payout, for the same reason. The Payout rule
 * exists because one person could otherwise send a Campaign's money to
 * themselves; here the risk is one Admin inventing a donation and one more
 * rubber-stamping it, and the proof of transfer is the only thing a provider
 * is not there to confirm. So:
 *
 *   record   one Admin, with the proof. Posts nothing -- a record is not yet a
 *            movement of money, and a balance anyone can spend must not appear
 *            before a second person has agreed the money is real.
 *   approve  a DIFFERENT Admin. This is where the money enters the books.
 *   reject   a different Admin, with a reason. Nothing was ever posted; the
 *            record and its proof stay, because a decision is not a deletion.
 *   reverse  a third Admin again -- neither the recorder nor the approver.
 *            An opposite journal that takes the money back out. Never a delete
 *            and never an edit of the original rows.
 *
 * WHERE THE MONEY LANDS, and the two rules that come with it:
 *
 *  - CAMPAIGN_BALANCE for a Campaign, PROGRAM_BALANCE for a Program, with no
 *    Escrow Hold and neither fee. There was no provider to charge and no
 *    online gift to take a percentage of, so the credited amount is exactly
 *    the rupiah that arrived.
 *  - It enters the Campaign collected figure in the same transaction as the
 *    ledger, exactly as the settlement webhook does, so the display figure and
 *    the books move together and cannot drift. A Program has no collected
 *    figure, so nothing is written there.
 *
 * WHY THE REVERSAL IS A THIRD PERSON AND NOT A FOURTH DECISION BY EITHER OF
 * THE FIRST TWO. The two-person rule exists so no single Admin can invent a
 * donation and have it rubber-stamped. If the reversal were open to the
 * recorder or the approver, the rule would be worth nothing at the one moment
 * it matters most: record a contribution, approve it yourself two minutes
 * later, reverse it yourself, and the books are back where they started with
 * three decisions on the record and nobody outside the pair to notice. So
 * reverseManualContribution refuses both of them, with the same
 * SelfApprovalError an approval of the wrong person gets, before it reads the
 * balance and before any write.
 *
 * WHY A DEMO CAMPAIGN IS REFUSED, AT RECORDING AND AT APPROVAL. A Demo
 * Campaign's data is fictional (CONTEXT.md, Demo Campaign), and a Payout and a
 * Refund already refuse it by name, both when the money path is opened. A
 * contribution to one would be a claim that real rupiah arrived for a Campaign
 * with no real donors, and once credited it could never leave again, because
 * both of those paths are closed to it. So the refusal is on the record as
 * well as on the credit: there is no such thing as a legitimate contribution
 * to a Demo Campaign, and refusing only at approval would leave a queue full of
 * entries that can only ever be rejected. `requireNotDemoCampaign` is the one
 * reading of `isDemo` in this module, called from both commands, so it cannot
 * drift away from the two paths that already refuse it.
 *
 * WHY AN ADMIN WHO OWNS THE CAMPAIGN IS REFUSED. That is the one check here
 * that is not about the two-person rule, and it is the most important: a
 * Fundraiser who also holds the ADMIN assignment could credit their own
 * Campaign with money that never arrived and then pay it straight out through
 * a Payout. `requireNotOwnerAsAdmin` is the same judgement a Payout approval
 * makes. A Program has no Fundraiser, so nothing is refused there.
 *
 * WHY THE REVERSAL CHECKS THE BALANCE AND NOT THE PAYOUTS. Which rupiah a
 * Payout spent is not something the ledger records -- balances are derived by
 * summing entries, and entries carry no provenance within a shared pool. What
 * IS knowable, under the subject's row lock, is whether the pool still holds
 * the amount. If it does not, some of this money has already been paid out and
 * the opposite journal would drive the balance negative, so it is refused and a
 * human deals with it. The alternative -- tracking provenance -- would mean a
 * second source of truth about money, which is the thing this ledger exists to
 * avoid.
 *
 * Callers establish the ADMIN Capacity (the routes do, through
 * withAssignmentCheck); these commands take the acting id because they also
 * have to compare it against the recorder's and the owner's.
 */

export {
  DemoCampaignError,
  ManualContributionAlreadySpentError,
  ManualContributionAmountError,
  ManualContributionInputError,
  ManualContributionNotApprovedError,
  ManualContributionNotFoundError,
  ManualContributionNotPendingError,
  ManualContributionProofRequiredError,
  ManualContributionTargetError,
  SelfApprovalError,
  OwnSubjectConflictError,
};

const MAX_PROOF_REFERENCE_LENGTH = 500;
const MAX_NOTE_LENGTH = 1000;
const MAX_REASON_LENGTH = 1000;

/**
 * What a Manual Contribution is aimed at: a Campaign, a Program, or -- the
 * case that has to be refusable rather than unrepresentable -- both at once.
 *
 * Two nullable fields rather than a discriminated union on purpose. A union
 * cannot express "both", so a caller building one would have to pick for the
 * service, and the mistake would be invisible. Here the mistake is a value,
 * and assertExactlyOneManualContributionSubject can refuse it by name.
 */
export type ManualContributionTarget = {
  campaignId?: string | null;
  programId?: string | null;
};

/**
 * Exactly one target, narrowed to the subject the ledger can post to.
 *
 * Prisma cannot say "one of these two nullable columns must be set", so this is
 * the check that does, and it runs before anything is written rather than
 * after. A contribution with no target would be money belonging to nobody;
 * one with two targets would be a single amount in two balances.
 *
 * `neither` and `both` are parameters because the two callers mean different
 * things by the refusal: a request that named nothing is an Admin who has not
 * filled the form in, while a stored row that names nothing can only be
 * corrupt data, and saying so is more use than repeating the first message.
 */
function assertExactlyOneManualContributionSubject(
  target: ManualContributionTarget,
  { neither, both }: { neither: string; both: string },
): ManualContributionSubject {
  const campaignId = typeof target.campaignId === 'string' ? target.campaignId.trim() : '';
  const programId = typeof target.programId === 'string' ? target.programId.trim() : '';

  if (campaignId && programId) {
    throw new ManualContributionTargetError(both);
  }
  if (!campaignId && !programId) {
    throw new ManualContributionTargetError(neither);
  }
  return campaignId
    ? { type: 'campaign', campaignId }
    : { type: 'program', programId };
}

const UNFILLED_TARGET = {
  neither: 'Campaign atau Program yang dituju wajib diisi.',
  both: 'Manual Contribution tidak boleh menunjuk Campaign dan Program sekaligus.',
};

const UNPOSTABLE_TARGET = {
  neither: 'Manual Contribution ini tidak menunjuk Campaign maupun Program, sehingga tidak bisa dibukukan.',
  both: 'Manual Contribution menunjuk Campaign dan Program sekaligus, sehingga tidak bisa dibukukan.',
};

/**
 * ManualContribution.amount is an Int, so MAX_RUPIAH_AMOUNT (./ledger) is the
 * real limit on what a contribution can be. Refusing it here rather than letting
 * the write fail means a too-large amount is a 400 with a message about the
 * amount, not a driver error no route can turn into a 400.
 */
function assertAmountIsRupiah(amount: unknown): asserts amount is number {
  if (
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > MAX_RUPIAH_AMOUNT
  ) {
    throw new ManualContributionAmountError();
  }
}

function cleanText(value: unknown, { field, max, required }: { field: string; max: number; required: boolean }): string | null {
  if (value === undefined || value === null) {
    if (required) throw new ManualContributionInputError(`${field} wajib diisi.`);
    return null;
  }
  if (typeof value !== 'string') throw new ManualContributionInputError(`${field} harus berupa teks.`);
  const trimmed = value.trim();
  if (trimmed === '') {
    if (required) throw new ManualContributionInputError(`${field} wajib diisi.`);
    return null;
  }
  if (trimmed.length > max) {
    throw new ManualContributionInputError(`${field} paling panjang ${max} karakter.`);
  }
  return trimmed;
}

function cleanProofReference(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ManualContributionProofRequiredError();
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_PROOF_REFERENCE_LENGTH) {
    throw new ManualContributionInputError(
      `Bukti transfer paling panjang ${MAX_PROOF_REFERENCE_LENGTH} karakter.`,
    );
  }
  return trimmed;
}

function cleanReason(value: unknown): string {
  const reason = cleanText(value, { field: 'Alasan', max: MAX_REASON_LENGTH, required: true });
  // cleanText's required branch already refused a blank; this states the
  // invariant rather than casting it away.
  if (reason === null) throw new ManualContributionInputError('Alasan wajib diisi.');
  return reason;
}

async function assertTargetExists(
  tx: Prisma.TransactionClient,
  subject: ManualContributionSubject,
): Promise<void> {
  if (subject.type === 'campaign') {
    const campaign = await tx.campaign.findUnique({ where: { id: subject.campaignId }, select: { id: true } });
    if (!campaign) throw new ManualContributionNotFoundError(subject.campaignId);
    return;
  }
  const program = await tx.program.findUnique({ where: { id: subject.programId }, select: { id: true } });
  if (!program) throw new ManualContributionNotFoundError(subject.programId);
}

/**
 * A Demo Campaign's data is fictional, so no real money may be recorded
 * against it or credited to it -- CONTEXT.md, Demo Campaign. The same
 * DemoCampaignError a Payout request and a Refund request throw, from one
 * function both of this module's commands call, so the rule is read once here
 * rather than copied into each of them and into the two paths that already
 * refuse it.
 */
function requireNotDemoCampaign(state: SubjectState): void {
  if (state.isDemo) {
    throw new DemoCampaignError();
  }
}

/**
 * One Admin records a Manual Contribution. Posts nothing to the ledger and
 * writes nothing to any balance: until a second Admin approves, this is a
 * claim, not money.
 *
 * Takes a transaction client because the caller (the route) wraps it in one;
 * the target's existence and the owner's own-subject judgement are reads that
 * must not be able to slip out from under the write.
 */
export async function recordManualContribution(
  tx: Prisma.TransactionClient,
  params: {
    target: ManualContributionTarget;
    amount: number;
    proofReference: string;
    note?: string;
    recordedById: string;
  },
): Promise<ManualContribution> {
  const subject = assertExactlyOneManualContributionSubject(params.target, UNFILLED_TARGET);
  assertAmountIsRupiah(params.amount);
  const proofReference = cleanProofReference(params.proofReference);
  const note = cleanText(params.note, { field: 'Catatan', max: MAX_NOTE_LENGTH, required: false });

  await assertTargetExists(tx, subject);

  // Judged here as well as at approval: recording is where an Admin decides to
  // put money into a particular Campaign, and the Fundraiser of that Campaign
  // must not be the one doing it.
  if (subject.type === 'campaign') {
    const state = await lockAndLoad(tx, subject, new Date());
    if (state) {
      requireNotDemoCampaign(state);
      requireNotOwnerAsAdmin(state, params.recordedById);
    }
  }

  return tx.manualContribution.create({
    data: {
      amount: params.amount,
      campaignId: subject.type === 'campaign' ? subject.campaignId : null,
      programId: subject.type === 'program' ? subject.programId : null,
      proofReference,
      note,
      recordedById: params.recordedById,
      status: 'PENDING',
    },
  });
}

/**
 * The target of an already-recorded contribution, read back off its row.
 *
 * A stored row that names both or neither is corrupt data rather than an
 * unfilled form, and the refusal says so -- there is no account to post to, and
 * guessing which one was meant is how money ends up on the wrong side of the
 * platform.
 */
function subjectOf(
  contribution: { campaignId: string | null; programId: string | null },
): ManualContributionSubject {
  return assertExactlyOneManualContributionSubject(contribution, UNPOSTABLE_TARGET);
}

/**
 * Locks the target row, judges the actor against it, and reads its
 * withdrawable balance -- all in that order, all inside the caller's
 * transaction.
 *
 * A Campaign goes through the subject guard, which owns the Campaign row lock
 * and the lock order every money path follows, and which hands back the
 * ownership judgement a Payout approval also makes. A Program has no such
 * guard, and never will while a Program is not a withdrawable subject, so its
 * lock is taken here; it is the only row lock this module takes, and
 * subject-lock-single-owner.test.ts pins that.
 *
 * The balance read is the reason the lock is here at all: it is a plain SELECT
 * with no row of its own, so a concurrent Payout approval against the same
 * Campaign could drain the pool between this read and the write that trusts
 * it. The read is meaningless without the lock; the lock without the read
 * would be decoration.
 */
async function lockTargetAndJudge(
  tx: Prisma.TransactionClient,
  subject: ManualContributionSubject,
  actorId: string,
  sandbox: boolean,
): Promise<number> {
  if (subject.type === 'campaign') {
    // A null state cannot happen here, and is left alone rather than turned
    // into a refusal: ManualContribution.campaignId is a Restrict foreign key,
    // so a recorded row's Campaign still exists -- the database will not let
    // it be deleted out from under the contribution. The same reasoning
    // approvePayout gives for Payout.campaignId.
    const state = await lockAndLoad(tx, subject, new Date());
    if (state) {
      // Same order the Payout and Refund paths use: the Demo refusal, which
      // says the Campaign has no real money at all, before the ownership
      // judgement about who may touch it.
      requireNotDemoCampaign(state);
      requireNotOwnerAsAdmin(state, actorId);
    }
    return campaignBalance(tx, subject.campaignId, sandbox);
  }
  await tx.$queryRaw`SELECT id FROM "Program" WHERE id = ${subject.programId} FOR UPDATE`;
  return programBalance(tx, subject.programId, sandbox);
}

/**
 * A second Admin approves: the money enters the books, on the withdrawable
 * balance, with no hold and no fee.
 *
 * Shaped like approvePayout on purpose: read the record, refuse the
 * two-person breach before any write, take the subject's row lock, re-judge
 * everything that could have changed since recording, claim the status with a
 * predicated update, and only then post. The claim is what makes a second
 * approval of the same row a no-op rather than a second credit.
 */
export async function approveManualContribution(
  prisma: PrismaClient,
  params: { manualContributionId: string; decidedById: string },
): Promise<ManualContribution> {
  const { manualContributionId, decidedById } = params;

  await prisma.$transaction(async (tx) => {
    const contribution = await tx.manualContribution.findUnique({
      where: { id: manualContributionId },
    });
    if (!contribution) {
      throw new ManualContributionNotFoundError(manualContributionId);
    }

    // The entire two-person rule, checked before any write: a self-approval
    // leaves the contribution completely untouched, because it is an error,
    // not a decision this contribution has been through.
    if (contribution.recordedById === decidedById) {
      throw new SelfApprovalError('Manual Contribution');
    }

    if (contribution.status !== 'PENDING') {
      throw new ManualContributionNotPendingError(contribution.status);
    }

    const subject = subjectOf(contribution);

    // Lock the target, judge the actor against it, and read its balance --
    // before anything is written. Approval only ADDS to a balance, so the
    // figure itself proves nothing here; taking the lock anyway is what stops
    // a concurrent Payout approval from draining the pool mid-decision and
    // leaving this contribution written against a balance that no longer
    // covers it.
    // A Manual Contribution has no source row to take a mode from, so it takes
    // the marker in force when the money is booked (ticket 94): one recorded
    // during the beta is test money, in the sandbox pool, and never counts as
    // real. Its reversal reads the mode back off these entries below.
    const sandbox = currentSandboxStamp();
    await lockTargetAndJudge(tx, subject, decidedById, sandbox);

    const claimed = await tx.manualContribution.updateMany({
      where: { id: manualContributionId, status: 'PENDING' },
      data: { status: 'APPROVED', decidedById, decidedAt: new Date() },
    });
    if (claimed.count === 0) {
      // Another approval committed between the read above and this claim.
      throw new ManualContributionNotPendingError(
        'unknown (changed concurrently)',
        'lost the approval race',
      );
    }

    // Keyed on the contribution's own id, so a retried approval posts the
    // credit once and once only, on top of the status claim above.
    await postTransaction(
      tx,
      manualContributionReceivedLegs({ subject, amount: contribution.amount }),
      {
        manualContributionId: contribution.id,
        sandbox,
        transactionId: `manual-contribution-${contribution.id}`,
      },
    );

    // The display figure moves in the same transaction as the ledger, exactly
    // as the settlement webhook does it, so the two cannot disagree about a
    // rupiah. Only a Campaign has one.
    // Test money never touches the live counter (Campaign.collectedAmount is
    // public progress, and a sandbox contribution is not a real one).
    if (subject.type === 'campaign' && !sandbox) {
      await tx.campaign.update({
        where: { id: subject.campaignId },
        data: { collectedAmount: { increment: contribution.amount } },
      });
    }
  });

  return prisma.manualContribution.findUniqueOrThrow({ where: { id: manualContributionId } });
}

/**
 * A second Admin declines. Nothing is posted, because nothing was ever posted
 * -- but the record and its proof stay, because closing a queue entry is a
 * decision and this ledger's whole point is that decisions leave a trace.
 */
export async function rejectManualContribution(
  prisma: PrismaClient,
  params: { manualContributionId: string; decidedById: string; reason: string },
): Promise<ManualContribution> {
  const { manualContributionId, decidedById } = params;
  const reason = cleanReason(params.reason);

  await prisma.$transaction(async (tx) => {
    const contribution = await tx.manualContribution.findUnique({
      where: { id: manualContributionId },
    });
    if (!contribution) {
      throw new ManualContributionNotFoundError(manualContributionId);
    }
    if (contribution.recordedById === decidedById) {
      throw new SelfApprovalError('Manual Contribution');
    }
    if (contribution.status !== 'PENDING') {
      throw new ManualContributionNotPendingError(contribution.status);
    }

    const claimed = await tx.manualContribution.updateMany({
      where: { id: manualContributionId, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById, decidedAt: new Date(), decisionReason: reason },
    });
    if (claimed.count === 0) {
      throw new ManualContributionNotPendingError('unknown (changed concurrently)', 'lost the race');
    }
  });

  return prisma.manualContribution.findUniqueOrThrow({ where: { id: manualContributionId } });
}

/**
 * Takes the money back out: the mirror-image journal, in a new transaction,
 * with the original rows left exactly where they were.
 *
 * A third person does it. Neither the Admin who recorded the contribution nor
 * the Admin who approved it may reverse it, so the two-person rule still means
 * two people by the time the money leaves again; see the module comment for why
 * a reversal the pair could do itself would make the rule worth nothing.
 *
 * Refused once the balance no longer covers the amount -- see the module doc
 * comment for why the balance and not the Payout history is the test. The
 * reversal is its own Admin act, and the Admin who does it is judged against
 * the same ownership rule an approval is: a Campaign's own Fundraiser may not
 * move money in or out of it while wearing the ADMIN hat.
 */
export async function reverseManualContribution(
  prisma: PrismaClient,
  params: { manualContributionId: string; reversedById: string; reason: string },
): Promise<ManualContribution> {
  const { manualContributionId, reversedById } = params;
  const reason = cleanReason(params.reason);

  await prisma.$transaction(async (tx) => {
    const contribution = await tx.manualContribution.findUnique({
      where: { id: manualContributionId },
    });
    if (!contribution) {
      throw new ManualContributionNotFoundError(manualContributionId);
    }
    // Status first: a contribution that is not APPROVED has nothing to take
    // back, whoever asks, and that is the more basic thing to tell an Admin
    // than who they are (UAT round 2: the recorder reversing a still-pending
    // one was told "not by the person who recorded it"). No rule is loosened:
    // everyone is refused here, and the check below still refuses the pair
    // once it is APPROVED.
    if (contribution.status !== 'APPROVED') {
      throw new ManualContributionNotApprovedError(contribution.status);
    }
    // The two-person rule, at the reversal as well as at the approval, and for
    // the same reason: the pair that created this money may not also be the one
    // that takes it back out. Otherwise the whole rule collapses into one
    // person's afternoon -- record it, approve it, reverse it -- and the books
    // end where they began with nothing on the record for anyone else to have
    // seen. Both halves of the pair are refused, and the refusal is the same
    // SelfApprovalError an approval of the wrong person gets, thrown before
    // anything is written, so this decision has no trace either.
    if (
      reversedById === contribution.recordedById ||
      reversedById === contribution.decidedById
    ) {
      throw new SelfApprovalError('Manual Contribution', 'reversal');
    }

    const subject = subjectOf(contribution);
    // The mode it was booked in, read off its own entries: the marker may have
    // changed since, and a reversal must come out of the pool the money went in.
    const booked = await tx.ledgerEntry.findFirst({
      where: { transactionId: `manual-contribution-${contribution.id}` },
      select: { sandbox: true },
    });
    const sandbox = booked ? sandboxModeOf(booked) : false;
    const balance = await lockTargetAndJudge(tx, subject, reversedById, sandbox);

    // Read under the lock taken above, so this is current for as long as the
    // lock is held: if a Payout drained part of this money in the meantime, it
    // is visible here.
    if (balance < contribution.amount) {
      throw new ManualContributionAlreadySpentError(contribution.amount, balance);
    }

    const claimed = await tx.manualContribution.updateMany({
      where: { id: manualContributionId, status: 'APPROVED' },
      data: { status: 'REVERSED', reversedById, reversedAt: new Date(), decisionReason: reason },
    });
    if (claimed.count === 0) {
      throw new ManualContributionNotApprovedError('unknown (changed concurrently)');
    }

    await postTransaction(
      tx,
      manualContributionReversedLegs({ subject, amount: contribution.amount }),
      {
        manualContributionId: contribution.id,
        sandbox,
        transactionId: `manual-contribution-reversed-${contribution.id}`,
      },
    );

    if (subject.type === 'campaign' && !sandbox) {
      await tx.campaign.update({
        where: { id: subject.campaignId },
        data: { collectedAmount: { decrement: contribution.amount } },
      });
    }
  });

  return prisma.manualContribution.findUniqueOrThrow({ where: { id: manualContributionId } });
}

/**
 * What the books say a set of Programs hold, beside what Manual Contributions
 * explain of it (csr-08). This is the one reader of a Program's balance
 * outside ledger.ts, so the guard in manual-contribution-isolation.test.ts
 * keeps holding: /impact and the Program page ask here and never name the
 * account themselves.
 *
 * - `booked`: every entry on the Program balance, net of reversals.
 * - `explained`: the same balance counting only entries that carry a Manual
 *   Contribution, the one thing allowed to move it.
 *
 * Both are the ledger, so a difference is a fault in the books, not a second
 * source disagreeing. Callers decide what to do with a fault
 * (assertCsrReconciles in ./impact.ts).
 */
export async function programBooks(
  tx: Prisma.TransactionClient,
  programIds: string[],
): Promise<{ booked: number; explained: number }> {
  const net = async (extra: Prisma.LedgerEntryWhereInput) => {
    const rows = await tx.ledgerEntry.groupBy({
      by: ['direction'] as const,
      where: { programId: { in: programIds }, account: 'PROGRAM_BALANCE', sandbox: false, ...extra },
      _sum: { amount: true },
    });
    let credits = 0;
    let debits = 0;
    for (const row of rows) {
      if (row.direction === 'CREDIT') credits += row._sum.amount ?? 0;
      if (row.direction === 'DEBIT') debits += row._sum.amount ?? 0;
    }
    return credits - debits;
  };
  return { booked: await net({}), explained: await net({ manualContributionId: { not: null } }) };
}
