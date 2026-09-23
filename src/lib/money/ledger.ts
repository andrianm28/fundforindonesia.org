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
  /** Required for campaign-scoped accounts, omitted otherwise. */
  campaignId?: string;
  /** Required for trip-scoped accounts, omitted otherwise. */
  volunteerTripId?: string;
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

/**
 * Which Campaign-or-Trip a leg-builder call is about.
 *
 * Explicit rather than a bare campaignId, so a Trip Fee settlement can credit
 * TRIP_BALANCE/ESCROW_HOLD scoped by volunteerTripId the same way a donation
 * credits CAMPAIGN_BALANCE/ESCROW_HOLD scoped by campaignId, without either
 * subject's id being mistaken for the other's.
 */
export type LedgerSubject =
  | { type: 'campaign'; campaignId: string }
  | { type: 'trip'; tripId: string };

function subjectFk(subject: LedgerSubject): { campaignId?: string; volunteerTripId?: string } {
  return subject.type === 'campaign'
    ? { campaignId: subject.campaignId }
    : { volunteerTripId: subject.tripId };
}

function balanceAccount(subject: LedgerSubject): 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE' {
  return subject.type === 'campaign' ? 'CAMPAIGN_BALANCE' : 'TRIP_BALANCE';
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
 * Accounts that only make sense against a specific subject (a campaign or a
 * trip).
 *
 * ESCROW_HOLD belongs here as much as CAMPAIGN_BALANCE/TRIP_BALANCE do: it is
 * one subject's money, merely not yet withdrawable. Leaving it out would let
 * an escrow leg be written with no subject attached, and the held amount
 * would then belong to nobody.
 */
const SUBJECT_SCOPED: ReadonlySet<string> = new Set<string>([
  'ESCROW_HOLD',
  'CAMPAIGN_BALANCE',
  'TRIP_BALANCE',
  'FROZEN_BALANCE',
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
    const hasSubjectId = Boolean(leg.campaignId) || Boolean(leg.volunteerTripId);
    if (SUBJECT_SCOPED.has(leg.account) && !hasSubjectId) {
      throw new InvalidLedgerLegError(`${leg.account} requires a campaignId or volunteerTripId.`);
    }
    if (!SUBJECT_SCOPED.has(leg.account) && hasSubjectId) {
      throw new InvalidLedgerLegError(
        `${leg.account} is a platform-level account and must not carry a campaignId or volunteerTripId.`,
      );
    }
    // ESCROW_HOLD is shared by both subjects, so only CAMPAIGN_BALANCE and
    // TRIP_BALANCE are pinned to their own FK below -- otherwise a leg built
    // with a campaign subject but a TRIP_BALANCE (or vice versa) account,
    // e.g. a mismatched refundRequestedLegs({ subject, source }) call, would
    // carry the wrong subject's FK and post invisibly to every balance query.
    if (leg.account === 'CAMPAIGN_BALANCE' && !leg.campaignId) {
      throw new InvalidLedgerLegError(`${leg.account} requires a campaignId.`);
    }
    if (leg.account === 'TRIP_BALANCE' && !leg.volunteerTripId) {
      throw new InvalidLedgerLegError(`${leg.account} requires a volunteerTripId.`);
    }
    if (leg.campaignId && leg.volunteerTripId) {
      throw new InvalidLedgerLegError('A leg cannot carry both campaignId and volunteerTripId.');
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
      volunteerTripId: leg.volunteerTripId ?? null,
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
  subject: LedgerSubject,
): Promise<number> {
  const where =
    subject.type === 'campaign'
      ? { account, campaignId: subject.campaignId }
      : { account, volunteerTripId: subject.tripId };

  const rows = await tx.ledgerEntry.groupBy({
    by: ['direction'],
    where,
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
  return accountBalance(tx, 'CAMPAIGN_BALANCE', { type: 'campaign', campaignId });
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
  return accountBalance(tx, 'ESCROW_HOLD', { type: 'campaign', campaignId });
}

/** Trip-scoped sibling of campaignBalance -- what a Volunteer Trip may actually withdraw. */
export async function tripBalance(tx: Prisma.TransactionClient, tripId: string): Promise<number> {
  return accountBalance(tx, 'TRIP_BALANCE', { type: 'trip', tripId });
}

/** Trip-scoped sibling of escrowBalance. */
export async function tripEscrowBalance(tx: Prisma.TransactionClient, tripId: string): Promise<number> {
  return accountBalance(tx, 'ESCROW_HOLD', { type: 'trip', tripId });
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

/** Integer-safe ceiling division of (a*b)/c via BigInt -- Math.ceil((a*b)/c)
 * on floats loses precision once a*b exceeds 2^53, reachable for realistic
 * Rupiah fee-share math. */
export function ceilMulDiv(a: number, b: number, c: number): number {
  const numerator = BigInt(a) * BigInt(b);
  const denominator = BigInt(c);
  return Number((numerator + denominator - BigInt(1)) / denominator);
}

/**
 * The Provider Fee portion of one Refund's `amount`, proportional to
 * amount / payment.amount, rounded up -- capped so the SUM of every non-
 * REJECTED/FAILED Refund's fee portion on the same Payment, taken in
 * creation order, never exceeds the Payment's actual providerFee. Without
 * this cumulative cap, two 50_000 partial refunds on a Gross 100_000 /
 * Provider Fee 3_333 Payment would each independently round their own
 * 1_666.5 up to 1_667, recognizing 3_334 total -- one rupiah more than the
 * Payment ever actually paid the provider.
 *
 * `priorAmounts` must be every OTHER non-REJECTED/FAILED Refund's `amount`
 * on this same Payment, in ascending `createdAt` order, excluding the
 * Refund whose portion is being computed now.
 */
export function providerFeePortionFor(
  payment: { amount: number; providerFee: number },
  refundAmount: number,
  priorAmounts: number[],
): number {
  let recognized = 0;
  for (const priorAmount of priorAmounts) {
    const raw = ceilMulDiv(payment.providerFee, priorAmount, payment.amount);
    recognized += Math.min(raw, Math.max(0, payment.providerFee - recognized));
  }
  const raw = ceilMulDiv(payment.providerFee, refundAmount, payment.amount);
  return Math.min(raw, Math.max(0, payment.providerFee - recognized), refundAmount);
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
  subject: LedgerSubject;
  grossAmount: number;
  providerFee: number;
}): LedgerLeg[] {
  const { subject, grossAmount, providerFee } = params;
  if (providerFee < 0 || providerFee > grossAmount) {
    throw new InvalidLedgerLegError(
      `providerFee ${providerFee} must be between 0 and the gross amount ${grossAmount}.`,
    );
  }
  const net = grossAmount - providerFee;

  const legs: LedgerLeg[] = [
    { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: grossAmount },
    { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: net, ...subjectFk(subject) },
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
export function escrowReleaseLegs(params: { subject: LedgerSubject; amount: number }): LedgerLeg[] {
  const { subject, amount } = params;
  return [
    { account: 'ESCROW_HOLD', direction: 'DEBIT', amount, ...subjectFk(subject) },
    { account: balanceAccount(subject), direction: 'CREDIT', amount, ...subjectFk(subject) },
  ];
}

/**
 * The immediate "seketika" freeze a Refund creates. Splits the Provider
 * Fee (and Platform Fee) portion out right here, at freeze time, rather
 * than deferring it to settlement -- the portion is a fact about the
 * Payment alone (providerFee, amount), not about pool state, so there is
 * no reason it needs the pool to be known first. This is also what makes
 * the settlement (refundApprovedLegs, below) simple: the pool is never
 * over-drawn by a fee it never actually held, so a negative pool reading
 * at settlement means genuine insolvency, not routine fee accounting --
 * and two refunds pending on the same pool never misattribute each
 * other's fee share as "shortfall" (see the doc comment there for the
 * concrete failure this replaced).
 *
 *   CREDIT FROZEN_BALANCE  amount              (always, the full requested amount)
 *   DEBIT  <source>        netPortion          (amount - fees; omitted if 0)
 *   DEBIT  PLATFORM_FEE    platformFeePortion  (omitted when zero)
 *   DEBIT  REFUND_COST     providerFeePortion  (omitted when zero)
 *
 * `source` is ESCROW_HOLD when the Payment's escrow hasn't matured yet, or
 * the subject's withdrawable balance once it has -- read directly off
 * Payment.escrowReleasedAt by the caller (./refunds.ts).
 */
export function refundRequestedLegs(params: {
  subject: LedgerSubject;
  amount: number;
  source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE';
  platformFeePortion: number;
  providerFeePortion: number;
}): LedgerLeg[] {
  const { subject, amount, source, platformFeePortion, providerFeePortion } = params;
  const combinedFeePortion = platformFeePortion + providerFeePortion;
  if (combinedFeePortion > amount) {
    throw new InvalidLedgerLegError(
      `Combined Platform Fee (${platformFeePortion}) and Provider Fee (${providerFeePortion}) portions ` +
        `exceed the refunded amount ${amount} -- refusing to post a freeze that would debit ${source} a negative net portion.`,
    );
  }
  const netPortion = amount - combinedFeePortion;
  const legs: LedgerLeg[] = [
    { account: 'FROZEN_BALANCE', direction: 'CREDIT', amount, ...subjectFk(subject) },
  ];
  if (netPortion > 0) {
    legs.push({ account: source, direction: 'DEBIT', amount: netPortion, ...subjectFk(subject) });
  }
  if (platformFeePortion > 0) {
    legs.push({ account: 'PLATFORM_FEE', direction: 'DEBIT', amount: platformFeePortion });
  }
  if (providerFeePortion > 0) {
    legs.push({ account: 'REFUND_COST', direction: 'DEBIT', amount: providerFeePortion });
  }
  return legs;
}

/**
 * The gross-recognition posting when a Refund is approved. Closes out
 * FROZEN_BALANCE in full and credits the donor the full Gross. `shortfall`
 * here means genuine pool insolvency ONLY (e.g. a Payout already drained
 * the pool below this refund's net share) -- the fee is never part of it,
 * because refundRequestedLegs already removed exactly the net share from
 * the pool at freeze time, not a moment before.
 *
 *   DEBIT  FROZEN_BALANCE  amount     (always, closes the freeze)
 *   CREDIT REFUND_CLEARING amount     (always, full Gross to the donor)
 *   DEBIT  REFUND_COST     shortfall  (omitted when zero)
 *   CREDIT <source>        shortfall  (omitted when zero -- platform tops the
 *                                       pool back up for a genuine shortfall)
 */
export function refundApprovedLegs(params: {
  subject: LedgerSubject;
  amount: number;
  source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE';
  shortfall: number;
}): LedgerLeg[] {
  const { subject, amount, source, shortfall } = params;
  if (shortfall > amount) {
    throw new InvalidLedgerLegError(
      `Shortfall ${shortfall} exceeds the refunded amount ${amount} -- refusing to post a settlement that would debit FROZEN_BALANCE negative.`,
    );
  }
  const legs: LedgerLeg[] = [
    { account: 'REFUND_CLEARING', direction: 'CREDIT', amount },
    { account: 'FROZEN_BALANCE', direction: 'DEBIT', amount, ...subjectFk(subject) },
  ];
  if (shortfall > 0) {
    legs.push({ account: 'REFUND_COST', direction: 'DEBIT', amount: shortfall });
    legs.push({ account: source, direction: 'CREDIT', amount: shortfall, ...subjectFk(subject) });
  }
  return legs;
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
export function payoutInstructedLegs(params: { subject: LedgerSubject; amount: number }): LedgerLeg[] {
  const { subject, amount } = params;
  return [
    { account: balanceAccount(subject), direction: 'DEBIT', amount, ...subjectFk(subject) },
    { account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount },
  ];
}
