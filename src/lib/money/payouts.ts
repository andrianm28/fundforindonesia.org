import type { Payout, Prisma } from '@/generated/prisma/client';
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
 * Both functions here take a `Prisma.TransactionClient`, not the global
 * prisma client, for the same reason ledger.ts's functions do: a payout's
 * status change and the ledger entries describing it must commit together or
 * not at all.
 *
 * This task does not implement a submit step, so DRAFT -- what requestPayout
 * creates -- is the only status a payout is ever in before approval. SUBMITTED
 * stays in the schema's enum for a future submit flow; nothing here produces
 * it, and approveAndReleasePayout does not accept it.
 */

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
 * one.
 *
 * Ownership of the campaign itself (campaign.creatorId === requestedById) is
 * the caller's responsibility: withRoleCheck only proves "a campaign
 * creator", not "this campaign's creator", so the route checks that before
 * ever reaching here. What this function owns is the destination account:
 * `bankAccount.ownerId` must equal `requestedById` too. A verified account
 * that belongs to someone else satisfies "has a verifiedAt" on its own, and
 * would send this campaign's money to a stranger.
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
 * the provider, posts the instructed legs, and lands on PROCESSING. The brief
 * describes "approve" and "release" as two steps; this task exposes one
 * route for both, so they are one atomic transaction rather than a durable
 * APPROVED state a second call has to find and finish.
 *
 * Order of checks matters. Self-approval is checked before any write, so a
 * self-approval attempt leaves the payout completely untouched -- not
 * REJECTED, not annotated, because it is an error, not a decision. Balance is
 * re-read here rather than trusted from request time, because it can have
 * moved: a refund, another payout approved first.
 *
 * CONSTRAINT FOR THE NEXT PROVIDER: provider.createPayout is called inside
 * this open database transaction, exactly like task M4's createCharge call in
 * src/app/api/donations/route.ts, and safe for the same reason: this repo's
 * MockPaymentProvider does no real I/O. A real Xendit/Midtrans payouts
 * adapter turns this into an HTTP round-trip, and holding a transaction open
 * across one is how provider latency exhausts the connection pool. When a
 * real adapter lands, split this: commit the DRAFT -> APPROVED transition and
 * the balance check in one transaction, call the provider outside it, then
 * post the instructed legs and flip to PROCESSING in a second transaction --
 * reconciling a provider failure by leaving the payout APPROVED for a human
 * to retry, rather than rolling back an approval that genuinely happened.
 */
export async function approveAndReleasePayout(
  tx: Prisma.TransactionClient,
  params: {
    payoutId: string;
    approvedById: string;
    provider: PaymentProvider;
  },
): Promise<Payout> {
  const { payoutId, approvedById, provider } = params;

  const payout = await tx.payout.findUnique({
    where: { id: payoutId },
    include: { bankAccount: true },
  });
  if (!payout) {
    throw new PayoutNotFoundError(payoutId);
  }

  // The entire two-person rule. Without this equality check, approvedById is
  // decoration on the schema and nothing else enforces it.
  if (payout.requestedById === approvedById) {
    throw new SelfApprovalError();
  }

  if (payout.status !== 'DRAFT') {
    throw new InvalidPayoutStatusError(payout.status);
  }

  const balance = await campaignBalance(tx, payout.campaignId);
  if (payout.amount > balance) {
    throw new InsufficientBalanceError(payout.amount, balance);
  }

  // The database decides who wins, once: two approvals racing for the same
  // payout both pass every check above before either writes, so this
  // status-predicated update is what actually closes the window. The loser
  // sees count 0 and nothing it would have done next -- the provider call,
  // the ledger post, the PROCESSING flip -- ever runs.
  const claimed = await tx.payout.updateMany({
    where: { id: payoutId, status: 'DRAFT' },
    data: { status: 'APPROVED', approvedById, approvedAt: new Date() },
  });
  if (claimed.count === 0) {
    // payout.status above is the pre-update read and is now stale -- some
    // other write got here first, but this function does not re-read to find
    // out what it left behind. The message says so rather than repeating a
    // status that may no longer be true.
    throw new InvalidPayoutStatusError('unknown (changed concurrently)', 'lost the approval race');
  }

  const result = await provider.createPayout({
    referenceId: payout.id,
    amount: payout.amount,
    channelCode: payout.bankAccount.bankCode,
    accountNumber: payout.bankAccount.accountNumber,
    accountHolderName: payout.bankAccount.accountName,
    description: payout.description,
  });

  // Posted at instruction, not completion -- see payoutInstructedLegs' own
  // doc comment in ledger.ts. Money in flight must stop being withdrawable
  // immediately, or the same balance can be paid out twice while the first
  // transfer is still settling.
  await postTransaction(
    tx,
    payoutInstructedLegs({ campaignId: payout.campaignId, amount: payout.amount }),
    { payoutId: payout.id },
  );

  return tx.payout.update({
    where: { id: payoutId },
    data: { status: 'PROCESSING', providerRef: result.payoutId },
  });
}
