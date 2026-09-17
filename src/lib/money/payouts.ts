import type { Payout, Prisma, PrismaClient } from '@/generated/prisma/client';
import type { PaymentProvider } from '@/lib/payments';
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
 * it, and approveAndReleasePayout does not accept it.
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
 * only ever spent at approval, and approveAndReleasePayout is what actually
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
 * ADMIN approves a DRAFT payout and, in the same action, releases it: calls
 * the provider, posts the instructed legs, and lands on PROCESSING.
 *
 * This takes the top-level `PrismaClient`, not a `Prisma.TransactionClient`,
 * because it owns two SEPARATE transactions around one external call in
 * between -- unlike every other function in the money layer, which takes a
 * tx because it never does I/O of its own.
 *
 * WHY TWO TRANSACTIONS, NOT ONE. An earlier version of this function called
 * provider.createPayout from inside a single transaction wrapping the whole
 * approval, following the precedent set by task M4's createCharge call
 * (src/app/api/donations/route.ts). That precedent does not transfer: an
 * uncommitted Payment stub is an abandoned charge link, harmless to lose to a
 * rollback. An uncommitted PAYOUT is a real transfer that may have already
 * reached the bank, and rolling it back on any later failure -- a deadlock,
 * a dropped connection, anything after the provider call -- would erase every
 * trace of it from this database: status back to DRAFT, re-approvable, no
 * providerRef, no ledger entry, and nothing here reconciles against the
 * provider's own records. So the transactions are split so that whatever can
 * be committed durably before the provider is ever called, is:
 *
 *   Phase 1 (transaction): the two-person check, the status guard, the
 *   destination re-check, the balance re-check under a row lock, the
 *   DRAFT -> APPROVED transition, and the instructed ledger legs. Commits.
 *   The money has now stopped being withdrawable, and that fact is durable
 *   regardless of what happens next.
 *
 *   Provider call: outside any transaction.
 *
 *   Phase 2 (a second transaction): record providerRef and move to
 *   PROCESSING.
 *
 * A crash or a thrown error between the two phases leaves the payout
 * APPROVED, with its legs already posted and no providerRef -- visibly
 * incomplete and reconcilable by a human, and NOT double-spendable, because
 * phase 1 already spent the balance. This function deliberately does not
 * guess FAILED on a provider error and auto-revert it: an error from a real
 * adapter (a timeout, a dropped connection) does not prove the transfer
 * never reached the bank, and the webhook route already established the
 * precedent for this exact shape of ambiguity -- see the AMOUNT MISMATCH
 * branch in src/app/api/webhooks/[provider]/route.ts, which leaves a Payment
 * PENDING rather than mark it FAILED on an outcome it cannot be sure of. This
 * repo has no reconciliation sweep for a stuck APPROVED payout, the same way
 * it has none yet for a stuck-unprocessed WebhookEvent row -- both are left
 * for a human today.
 */
export async function approveAndReleasePayout(
  prisma: PrismaClient,
  params: {
    payoutId: string;
    approvedById: string;
    provider: PaymentProvider;
  },
): Promise<Payout> {
  const { payoutId, approvedById, provider } = params;

  const instructed = await prisma.$transaction(async (tx) => {
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

    // Posted at instruction, not completion, and committed in THIS
    // transaction -- before the provider is ever called. Money in flight
    // must stop being withdrawable immediately, and that fact must be
    // durable immediately: see this function's doc comment for why the
    // provider call does not happen inside this transaction. transactionId
    // is keyed on the payout id so this specific post can never happen
    // twice, on top of (not instead of) the updateMany guard above.
    await postTransaction(
      tx,
      payoutInstructedLegs({ campaignId: payout.campaignId, amount: payout.amount }),
      { payoutId: payout.id, transactionId: `payout-instructed-${payout.id}` },
    );

    return {
      campaignId: payout.campaignId,
      amount: payout.amount,
      description: payout.description,
      bankAccount: payout.bankAccount,
    };
  });

  let result;
  try {
    result = await provider.createPayout({
      referenceId: payoutId,
      amount: instructed.amount,
      channelCode: instructed.bankAccount.bankCode,
      accountNumber: instructed.bankAccount.accountNumber,
      accountHolderName: instructed.bankAccount.accountName,
      description: instructed.description,
    });
  } catch (err) {
    // Not caught to recover from -- re-thrown after logging loudly, exactly
    // like every other anomaly branch in this money layer. The payout stays
    // APPROVED with its legs already posted: see this function's doc comment
    // for why that is the correct state to leave it in, not FAILED and not a
    // rollback.
    console.error(
      `Payout ${payoutId}: provider.createPayout failed after its instructed legs were already ` +
        'committed. Left APPROVED with no providerRef for manual reconciliation.',
      err,
    );
    throw err;
  }

  // Phase 2: a second, separate transaction, guarded the same way as phase
  // 1's transition even though nothing else in this codebase writes an
  // APPROVED payout today -- a status-predicated update costs nothing and
  // rules out this call ever completing twice.
  const claimed = await prisma.payout.updateMany({
    where: { id: payoutId, status: 'APPROVED' },
    data: { status: 'PROCESSING', providerRef: result.payoutId },
  });
  if (claimed.count === 0) {
    // Should not happen -- nothing else transitions an APPROVED payout --
    // but the provider has already been instructed by this point, so this
    // must not be silently swallowed if it ever does.
    throw new InvalidPayoutStatusError('APPROVED', 'phase 2 update matched no row');
  }

  return prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
}
