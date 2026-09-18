import { randomUUID } from 'crypto';
import type { LedgerAccount, LedgerDirection, Prisma } from '@/generated/prisma/client';

/**
 * Double-entry ledger.
 *
 * Every movement of money is written as a set of entries that sum to zero.
 * Balances are derived by summing entries, never stored in a mutable column,
 * because a stored balance and a list of movements will eventually disagree and
 * there is then no way to tell which one lied.
 *
 * Campaign.collectedAmount stays in the schema as a denormalised figure for
 * display and sorting, but it is no longer the source of truth. When the two
 * disagree, the ledger is right.
 */

export interface LedgerLeg {
  account: LedgerAccount;
  direction: LedgerDirection;
  amount: number;
  /** Required for campaign-scoped accounts, omitted for platform-level ones. */
  campaignId?: string;
  memo?: string;
}

export interface PostOptions {
  paymentId?: string;
  refundId?: string;
  payoutId?: string;
  /**
   * Supply this to make posting idempotent across retries: the same id posts
   * one set of entries, not two. Generated when omitted.
   */
  transactionId?: string;
}

export class UnbalancedTransactionError extends Error {
  constructor(
    readonly debits: number,
    readonly credits: number,
  ) {
    super(
      `Ledger transaction does not balance: debits ${debits} != credits ${credits}. ` +
        'Refusing to post.',
    );
    this.name = 'UnbalancedTransactionError';
  }
}

export class InvalidLedgerLegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLedgerLegError';
  }
}

/**
 * Accounts that only make sense against a specific campaign.
 *
 * ESCROW_HOLD belongs here as much as CAMPAIGN_BALANCE does: it is one
 * campaign's money, merely not yet withdrawable. Leaving it out would let an
 * escrow leg be written with no campaign attached, and the held amount would
 * then belong to nobody.
 */
const CAMPAIGN_SCOPED: ReadonlySet<string> = new Set<string>([
  'ESCROW_HOLD',
  'CAMPAIGN_BALANCE',
]);

function assertLegsValid(legs: LedgerLeg[]): void {
  if (legs.length < 2) {
    // A single-sided entry is the classic way a ledger silently stops
    // balancing, so it is rejected outright rather than accepted and detected
    // later by a reconciliation job.
    throw new InvalidLedgerLegError('A ledger transaction needs at least two legs.');
  }

  for (const leg of legs) {
    if (!Number.isInteger(leg.amount)) {
      throw new InvalidLedgerLegError(
        `Amount must be an integer number of rupiah, got ${leg.amount}.`,
      );
    }
    if (leg.amount <= 0) {
      // Direction carries the sign. A negative amount would let the same
      // movement be expressed two ways, and then "sum the credits" stops
      // meaning anything.
      throw new InvalidLedgerLegError(
        `Amount must be positive; use direction to express sign. Got ${leg.amount}.`,
      );
    }
    if (CAMPAIGN_SCOPED.has(leg.account) && !leg.campaignId) {
      throw new InvalidLedgerLegError(`${leg.account} requires a campaignId.`);
    }
    if (!CAMPAIGN_SCOPED.has(leg.account) && leg.campaignId) {
      throw new InvalidLedgerLegError(
        `${leg.account} is a platform-level account and must not carry a campaignId.`,
      );
    }
  }
}

function assertBalanced(legs: LedgerLeg[]): void {
  const debits = legs
    .filter((l) => l.direction === 'DEBIT')
    .reduce((sum, l) => sum + l.amount, 0);
  const credits = legs
    .filter((l) => l.direction === 'CREDIT')
    .reduce((sum, l) => sum + l.amount, 0);
  if (debits !== credits) throw new UnbalancedTransactionError(debits, credits);
}

/**
 * Writes one balanced transaction.
 *
 * Takes a transaction client rather than the global prisma instance: ledger
 * entries must be written in the same database transaction as whatever they
 * describe. Posting a payment's entries in a separate transaction from the
 * payment's own status update is how a ledger ends up describing a world that
 * never happened.
 */
export async function postTransaction(
  tx: Prisma.TransactionClient,
  legs: LedgerLeg[],
  options: PostOptions = {},
): Promise<string> {
  assertLegsValid(legs);
  assertBalanced(legs);

  const transactionId = options.transactionId ?? randomUUID();

  const existing = await tx.ledgerEntry.count({ where: { transactionId } });
  if (existing > 0) {
    // Idempotent by transactionId: a webhook retry that reuses the provider's
    // event id posts nothing the second time.
    return transactionId;
  }

  await tx.ledgerEntry.createMany({
    data: legs.map((leg) => ({
      account: leg.account,
      direction: leg.direction,
      amount: leg.amount,
      campaignId: leg.campaignId ?? null,
      memo: leg.memo ?? null,
      paymentId: options.paymentId ?? null,
      refundId: options.refundId ?? null,
      payoutId: options.payoutId ?? null,
      transactionId,
    })),
  });

  return transactionId;
}

async function accountBalance(
  tx: Prisma.TransactionClient,
  account: LedgerAccount,
  campaignId: string,
): Promise<number> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ['direction'],
    where: { account, campaignId },
    _sum: { amount: true },
  });

  let credits = 0;
  let debits = 0;
  for (const row of rows) {
    if (row.direction === 'CREDIT') credits = row._sum.amount ?? 0;
    if (row.direction === 'DEBIT') debits = row._sum.amount ?? 0;
  }
  return credits - debits;
}

/**
 * What a campaign may actually withdraw, in rupiah.
 *
 * Credits minus debits on its CAMPAIGN_BALANCE account. Money still clearing at
 * the provider has not been credited anywhere yet; money inside the escrow hold
 * sits in ESCROW_HOLD and is deliberately NOT counted here; money already
 * instructed out has been debited. So this is the withdrawable figure, not the
 * lifetime-raised figure -- which is Campaign.collectedAmount's job.
 */
export async function campaignBalance(
  tx: Prisma.TransactionClient,
  campaignId: string,
): Promise<number> {
  return accountBalance(tx, 'CAMPAIGN_BALANCE', campaignId);
}

/**
 * Settled money still inside the dispute window, in rupiah.
 *
 * NOT YET SURFACED ANYWHERE. This function has no callers in src/ today --
 * there is no campaigner-facing balance UI at all yet. It exists so that
 * whoever builds that screen has the read already written; it is not itself
 * evidence that the figure is shown to anyone.
 *
 * Surfacing it -- as "masuk, belum bisa dicairkan" or equivalent -- is
 * required before the seven-day escrow hold (ESCROW_HOLD_DAYS, ./escrow.ts)
 * reaches real campaigners. Without it, a campaigner who watches a donation
 * arrive and then sees nothing withdrawable for a week has no way to tell
 * "held, on schedule" from "lost" -- and will reasonably conclude the money
 * is gone. This is an obligation on whoever builds that screen, not a
 * nice-to-have: ship the hold without this and campaigners will file support
 * tickets for money that was never missing.
 */
export async function escrowBalance(
  tx: Prisma.TransactionClient,
  campaignId: string,
): Promise<number> {
  return accountBalance(tx, 'ESCROW_HOLD', campaignId);
}

/**
 * Whether every transaction in the ledger balances.
 *
 * Prisma cannot express "entries sharing a transactionId sum to zero" as a
 * constraint, so it is asserted in tests and available here for a periodic
 * check. Returns the offending transaction ids, empty when healthy.
 */
export async function findUnbalancedTransactions(
  tx: Prisma.TransactionClient,
): Promise<Array<{ transactionId: string; debits: number; credits: number }>> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ['transactionId', 'direction'],
    _sum: { amount: true },
  });

  const totals = new Map<string, { debits: number; credits: number }>();
  for (const row of rows) {
    const entry = totals.get(row.transactionId) ?? { debits: 0, credits: 0 };
    if (row.direction === 'DEBIT') entry.debits += row._sum.amount ?? 0;
    else entry.credits += row._sum.amount ?? 0;
    totals.set(row.transactionId, entry);
  }

  // Array.from rather than spreading the iterator: this repo's tsconfig target
  // predates downlevel iteration, so `[...map.entries()]` does not compile.
  return Array.from(totals.entries())
    .filter(([, t]) => t.debits !== t.credits)
    .map(([transactionId, t]) => ({ transactionId, ...t }));
}

// ---------------------------------------------------------------------------
// The three movements this platform actually makes.
//
// Expressed as named builders rather than left to callers, so the shape of each
// movement is defined once. A caller assembling legs by hand is a caller who
// can credit the wrong account.
// ---------------------------------------------------------------------------

/**
 * A donation settled at the provider.
 *
 *   DEBIT  GATEWAY_CLEARING  gross   money arrived at the provider
 *   CREDIT ESCROW_HOLD       net     the campaign's, not yet withdrawable
 *   CREDIT PROVIDER_FEE      fee     what the provider kept
 *
 * Two things this gets deliberately right.
 *
 * The campaign is credited the NET. Crediting gross and hoping the fee is
 * deducted later is how a campaign ends up able to withdraw money that never
 * arrived.
 *
 * And it lands in ESCROW_HOLD, not CAMPAIGN_BALANCE. Settlement means the
 * provider has the money, not that the dispute window has closed; paying it
 * straight out means chasing a campaigner for a chargeback later.
 * escrowReleaseLegs moves it across when the hold matures.
 */
export function paymentSettledLegs(params: {
  campaignId: string;
  grossAmount: number;
  providerFee: number;
}): LedgerLeg[] {
  const { campaignId, grossAmount, providerFee } = params;
  if (providerFee < 0 || providerFee > grossAmount) {
    throw new InvalidLedgerLegError(
      `providerFee ${providerFee} must be between 0 and the gross amount ${grossAmount}.`,
    );
  }
  const net = grossAmount - providerFee;

  const legs: LedgerLeg[] = [
    { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: grossAmount },
    { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: net, campaignId },
  ];
  // Omitted entirely when zero: a zero-amount leg is rejected by
  // assertLegsValid, and a fee-free provider is a legitimate case.
  if (providerFee > 0) {
    legs.push({ account: 'PROVIDER_FEE', direction: 'CREDIT', amount: providerFee });
  }
  return legs;
}

/**
 * An escrow hold reaching maturity.
 *
 *   DEBIT  ESCROW_HOLD       amount   out of the dispute window
 *   CREDIT CAMPAIGN_BALANCE  amount   now withdrawable
 *
 * The only way money becomes withdrawable. Nothing else credits
 * CAMPAIGN_BALANCE.
 */
export function escrowReleaseLegs(params: {
  campaignId: string;
  amount: number;
}): LedgerLeg[] {
  return [
    { account: 'ESCROW_HOLD', direction: 'DEBIT', amount: params.amount, campaignId: params.campaignId },
    { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: params.amount, campaignId: params.campaignId },
  ];
}

/**
 * A refund going back to the donor.
 *
 *   DEBIT  <source>         amount   taken back off the campaign
 *   CREDIT REFUND_CLEARING  amount   on its way to the donor
 *
 * The source is explicit because it changes which pot shrinks. A refund inside
 * the hold window must debit ESCROW_HOLD -- the money is still sitting there.
 * Always debiting CAMPAIGN_BALANCE would drive it negative while the escrow
 * account stayed full, and the campaign would appear to owe money it has not
 * been given yet.
 *
 * `amount` is a refund of the NET this payment actually credited -- the same
 * figure paymentSettledLegs credited to ESCROW_HOLD (grossAmount minus
 * providerFee), never the gross the donor paid. `creditedAmount` is that
 * figure, passed in by the caller (the payment's own `amount - providerFee`)
 * so this function can refuse a refund it did not actually receive: a full
 * refund posted at gross would debit `source` by exactly the provider fee
 * more than this payment ever credited it, driving the account negative by
 * that fee. Matches the same shape as paymentSettledLegs rejecting a
 * providerFee larger than the gross above -- an impossible amount is refused
 * here, not merely produced and left for a later reconciliation to notice.
 */
export function refundLegs(params: {
  campaignId: string;
  amount: number;
  source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE';
  creditedAmount: number;
}): LedgerLeg[] {
  const { campaignId, amount, source, creditedAmount } = params;
  if (amount > creditedAmount) {
    throw new InvalidLedgerLegError(
      `Refund amount ${amount} exceeds the ${creditedAmount} this payment actually credited ` +
        `(the NET it credited, not the gross the donor paid) -- refusing to post a refund that ` +
        `would drive ${source} negative by the difference.`,
    );
  }
  return [
    { account: source, direction: 'DEBIT', amount, campaignId },
    { account: 'REFUND_CLEARING', direction: 'CREDIT', amount },
  ];
}

/**
 * A payout instructed to the campaign's bank account.
 *
 *   DEBIT  CAMPAIGN_BALANCE  amount   no longer withdrawable
 *   CREDIT PAYOUT_CLEARING   amount   in flight to the bank
 *
 * Posted when the transfer is INSTRUCTED, not when it completes. Money in
 * flight must stop being withdrawable immediately, or the same balance can be
 * paid out twice.
 */
export function payoutInstructedLegs(params: {
  campaignId: string;
  amount: number;
}): LedgerLeg[] {
  return [
    { account: 'CAMPAIGN_BALANCE', direction: 'DEBIT', amount: params.amount, campaignId: params.campaignId },
    { account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount: params.amount },
  ];
}
