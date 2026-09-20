import type { Payout, Prisma, PrismaClient } from '@/generated/prisma/client';
import { campaignBalance, payoutInstructedLegs, postTransaction } from './ledger';

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

export class DemoCampaignError extends Error {
  constructor() {
    super(
      'Campaign is marked isDemo -- sample content from before the money layer existed, with no ' +
        'real ledger balance behind it. Refused by name so the reason is "this is a demo ' +
        'campaign", not "insufficient balance", which would send an operator hunting for money ' +
        'that was never there.',
    );
    this.name = 'DemoCampaignError';
  }
}

export class BankAccountNotEligibleError extends Error {
  constructor() {
    super(
      'BankAccount does not exist, is not owned by the requester, or has no verifiedAt. ' +
        'A payout destination must be both owned by the requester and verified -- either ' +
        'gap alone would let money be sent to a stranger.',
    );
    this.name = 'BankAccountNotEligibleError';
  }
}

export class InsufficientBalanceError extends Error {
  constructor(
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Requested payout of ${requested} exceeds the withdrawable balance of ${available}. ` +
        'Balances are derived from the ledger, never from Campaign.collectedAmount.',
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class SelfApprovalError extends Error {
  constructor() {
    super(
      'approvedById equals requestedById. The two-person rule is this equality check and ' +
        'nothing else -- refused before any write, not recorded as a decision.',
    );
    this.name = 'SelfApprovalError';
  }
}

export class InvalidPayoutStatusError extends Error {
  constructor(
    readonly currentStatus: string,
    detail?: string,
  ) {
    super(`Payout status is ${currentStatus}; this transition is not allowed.${detail ? ` (${detail})` : ''}`);
    this.name = 'InvalidPayoutStatusError';
  }
}

export class PayoutNotFoundError extends Error {
  constructor(readonly payoutId: string) {
    super(`Payout ${payoutId} not found.`);
    this.name = 'PayoutNotFoundError';
  }
}

/**
 * Campaign-owner requests a payout. Creates a DRAFT and posts nothing to the
 * ledger -- a request is not yet a movement of money, only a proposal to make
 * one. This function takes a `Prisma.TransactionClient` because its caller
 * (the route) wraps it in a single `prisma.$transaction`; nothing here does
 * external I/O, so there is no reason to split it the way approval is split
 * below.
 *
 * Ownership of the campaign itself (campaign.creatorId === requestedById) is
 * the caller's responsibility: withRoleCheck only proves "a campaign
 * creator", not "this campaign's creator", so the route checks that before
 * ever reaching here. What this function owns is the destination account:
 * `bankAccount.ownerId` must equal `requestedById` too. A verified account
 * that belongs to someone else satisfies "has a verifiedAt" on its own, and
 * would send this campaign's money to a stranger.
 *
 * Nothing is reserved against the balance here -- two DRAFT requests can be
 * created for more than the campaign has. That is deliberate: the balance is
 * only ever spent at approval, and approvePayout is what actually
 * closes the "satisfiable twice" gap, under a lock, at the moment money
 * would really move.
 */
export async function requestPayout(
  tx: Prisma.TransactionClient,
  params: {
    campaignId: string;
    requestedById: string;
    bankAccountId: string;
    amount: number;
    description: string;
  },
): Promise<Payout> {
  const { campaignId, requestedById, bankAccountId, amount, description } = params;

  // Checked before the bank account and the balance: a demo campaign has no
  // ledger balance either, so InsufficientBalanceError would already stop
  // this -- but that message reads as "the money isn't here yet", which
  // sends whoever sees it looking for a shortfall that does not exist. This
  // is the one door money leaves the platform through (see the module doc
  // comment above), so it is also the one place this needs to be checked.
  const campaign = await tx.campaign.findUnique({
    where: { id: campaignId },
    select: { isDemo: true },
  });
  if (campaign?.isDemo) {
    throw new DemoCampaignError();
  }

  const bankAccount = await tx.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount || bankAccount.ownerId !== requestedById || !bankAccount.verifiedAt) {
    throw new BankAccountNotEligibleError();
  }

  // Never against Campaign.collectedAmount: that figure counts lifetime
  // donations and knows nothing about escrow, refunds, or money already
  // instructed out. Paying against it is how the same money leaves twice.
  const balance = await campaignBalance(tx, campaignId);
  if (amount > balance) {
    throw new InsufficientBalanceError(amount, balance);
  }

  return tx.payout.create({
    data: {
      campaignId,
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
      throw new SelfApprovalError();
    }

    if (payout.status !== 'DRAFT') {
      throw new InvalidPayoutStatusError(payout.status);
    }

    // Re-checked here, not trusted from request time. Nothing in this repo
    // writes a BankAccount after creation except (by hand, outside the app)
    // clearing verifiedAt when one turns out to be fraudulent -- exactly the
    // scenario this exists to catch, in the window between a campaigner's
    // request and an admin's approval. Ownership is re-checked for the same
    // reason it was checked at all: ownerId is the only thing tying this
    // destination to the campaign's creator.
    const { bankAccount } = payout;
    if (!bankAccount || bankAccount.ownerId !== payout.requestedById || !bankAccount.verifiedAt) {
      throw new BankAccountNotEligibleError();
    }

    // The contended resource is the campaign's withdrawable BALANCE, not
    // this payout row -- a second, different DRAFT payout against the same
    // campaign is a different row entirely and would sail straight past a
    // lock on this one. Locking the Campaign row is what serialises two
    // admins approving two different payouts against the same balance at
    // once. Without it: campaignBalance below is a plain SELECT ... GROUP BY
    // with no row to lock, these transactions run at Postgres's default READ
    // COMMITTED (there is no isolationLevel set anywhere in this repo), and
    // each transaction only locks its own Payout row via the updateMany
    // further down -- so two concurrent approvals of two DIFFERENT payouts
    // would each read the same pre-spend balance, each pass the check below,
    // and both commit. CAMPAIGN_BALANCE would go negative with nothing to
    // stop it, since balances are derived by summing entries, never stored.
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${payout.campaignId} FOR UPDATE`;

    // Balance can have moved since the request -- a refund, another payout
    // approved first -- and, now that this transaction holds the campaign's
    // row lock, this read is guaranteed current for as long as the lock is
    // held.
    const balance = await campaignBalance(tx, payout.campaignId);
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
      payoutInstructedLegs({ campaignId: payout.campaignId, amount: payout.amount }),
      { payoutId: payout.id, transactionId: `payout-instructed-${payout.id}` },
    );

  });

  return prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
}
