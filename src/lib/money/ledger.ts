import { randomUUID } from 'crypto';
import type { LedgerAccount, LedgerDirection, Prisma } from '@/generated/prisma/client';
import { isPrismaUniqueConstraintViolation } from '@/lib/prisma-errors';

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
  /** Required for PROGRAM_BALANCE, omitted otherwise. */
  programId?: string;
  memo?: string;
}

export interface PostOptions {
  paymentId?: string;
  refundId?: string;
  payoutId?: string;
  /** Which Manual Contribution a movement belongs to, for the off-gateway accounts. */
  manualContributionId?: string;
  /**
   * The id that makes this posting happen once, ever. A second attempt with
   * the same id is refused by the database (see postTransaction), not silently
   * ignored. Generated when omitted, so a caller that never retries has
   * nothing to think about.
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

/**
 * Which Campaign-or-Program a Manual Contribution is about (CONTEXT.md,
 * Manual Contribution).
 *
 * Deliberately NOT an extension of LedgerSubject: a Program is not a Campaign
 * and a Program-targeted balance is never a Payout source, so widening the
 * type every Payout and Refund path is written against would have handed that
 * possibility to code that must not have it. A Volunteer Trip is not a target
 * at all, which is why TRIP_BALANCE is unreachable from here.
 */
export type ManualContributionSubject =
  | { type: 'campaign'; campaignId: string }
  | { type: 'program'; programId: string };

function subjectFk(subject: LedgerSubject): { campaignId?: string; volunteerTripId?: string } {
  return subject.type === 'campaign'
    ? { campaignId: subject.campaignId }
    : { volunteerTripId: subject.tripId };
}

function balanceAccount(subject: LedgerSubject): 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE' {
  return subject.type === 'campaign' ? 'CAMPAIGN_BALANCE' : 'TRIP_BALANCE';
}

/**
 * The account a Manual Contribution credits, and the FK that scopes it.
 *
 * Its own two functions rather than a widened `balanceAccount`, so the trip
 * branch simply does not exist: a Manual Contribution can name a Campaign or a
 * Program and nothing else, and there is no code path here that could reach
 * TRIP_BALANCE however it was called.
 */
function manualContributionFk(
  subject: ManualContributionSubject,
): { campaignId?: string; programId?: string } {
  return subject.type === 'campaign'
    ? { campaignId: subject.campaignId }
    : { programId: subject.programId };
}

function manualContributionBalanceAccount(
  subject: ManualContributionSubject,
): 'CAMPAIGN_BALANCE' | 'PROGRAM_BALANCE' {
  return subject.type === 'campaign' ? 'CAMPAIGN_BALANCE' : 'PROGRAM_BALANCE';
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
 * Posting a transactionId that is already in the ledger.
 *
 * A distinct class rather than a raw constraint error, because the caller has
 * to be able to tell this apart from a genuine write failure: "this movement
 * is already recorded" needs no retry and no alert, while "the write failed"
 * does. Refusing loudly is also the point -- the alternative this replaced
 * (reading first, then writing only if absent) could not tell a duplicate
 * from a first posting, and silently did nothing.
 */
export class DuplicateLedgerTransactionError extends Error {
  constructor(readonly transactionId: string) {
    super(
      `Ledger transaction ${transactionId} is already posted. ` +
        'Its transactionId is claimed by one entry, and the database refuses a second claim; ' +
        'posting it again would count the same movement of money twice.',
    );
    this.name = 'DuplicateLedgerTransactionError';
  }
}

/**
 * Prisma's unique-constraint violation (P2002) is matched on the code alone,
 * deliberately. The only unique constraint a createMany of ledger legs can
 * reach is the claim index (`LedgerEntry_transactionId_claim_key`, WHERE
 * "legIndex" = 0): the primary key is a cuid default this code never supplies,
 * and no other unique index exists on the table. So P2002 here can only mean
 * the transactionId is already claimed.
 *
 * Matching the index name instead would narrow the guarantee to a shape that
 * moves: against a real database (see the migration test, which runs this
 * against Postgres) Prisma 7 over the pg driver adapter reports the constraint
 * at `meta.driverAdapterError.cause.constraint.index` and puts no `target` or
 * `field_name` in `meta` at all. `code` is the one part that is the same
 * whatever a driver adapter decides to include, and the one part Prisma
 * documents.
 */

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
  'PROGRAM_BALANCE',
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
    const hasSubjectId =
      Boolean(leg.campaignId) || Boolean(leg.volunteerTripId) || Boolean(leg.programId);
    if (!SUBJECT_SCOPED.has(leg.account) && hasSubjectId) {
      throw new InvalidLedgerLegError(
        `${leg.account} is a platform-level account and must not carry a campaignId, volunteerTripId, or programId.`,
      );
    }
    // Each withdrawable account is pinned to its own FK, checked BEFORE the
    // generic "a subject id at all" rule below so the refusal names the id
    // that is actually missing. ESCROW_HOLD and FROZEN_BALANCE are shared
    // across subjects, so they are deliberately absent from this list --
    // otherwise a leg built with a campaign subject but a TRIP_BALANCE (or
    // vice versa) account, e.g. a mismatched refundRequestedLegs({ subject,
    // source }) call, would carry the wrong subject's FK and post invisibly to
    // every balance query.
    if (leg.account === 'CAMPAIGN_BALANCE' && !leg.campaignId) {
      throw new InvalidLedgerLegError(`${leg.account} requires a campaignId.`);
    }
    if (leg.account === 'TRIP_BALANCE' && !leg.volunteerTripId) {
      throw new InvalidLedgerLegError(`${leg.account} requires a volunteerTripId.`);
    }
    // This is what stops a Program-targeted Manual Contribution from landing
    // in a Campaign's withdrawable balance because the caller mixed up its
    // subject -- the one leak the Program Balance is most exposed to.
    if (leg.account === 'PROGRAM_BALANCE' && !leg.programId) {
      throw new InvalidLedgerLegError(`${leg.account} requires a programId.`);
    }
    if (SUBJECT_SCOPED.has(leg.account) && !hasSubjectId) {
      throw new InvalidLedgerLegError(
        `${leg.account} requires a campaignId or volunteerTripId or a programId.`,
      );
    }
    if (leg.campaignId && leg.volunteerTripId) {
      throw new InvalidLedgerLegError('A leg cannot carry both campaignId and volunteerTripId.');
    }
    if (leg.programId && (leg.campaignId || leg.volunteerTripId)) {
      throw new InvalidLedgerLegError(
        'A leg cannot carry a programId alongside a campaignId or volunteerTripId.',
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
 * Writes one balanced transaction, once.
 *
 * Takes a transaction client rather than the global prisma instance: ledger
 * entries must be written in the same database transaction as whatever they
 * describe. Posting a payment's entries in a separate transaction from the
 * payment's own status update is how a ledger ends up describing a world that
 * never happened.
 *
 * A transactionId is claimed by the first leg (`legIndex` 0), and the
 * database's partial unique index `LedgerEntry_transactionId_claim_key`
 * (WHERE "legIndex" = 0) makes that claim unrepeatable: the second posting of
 * an id fails on the constraint, whichever of two racing callers reaches the
 * database second, and the whole statement is rolled back rather than
 * half-applied. A second attempt therefore raises DuplicateLedgerTransactionError.
 *
 * What this deliberately does NOT do is read first and write only if the id is
 * absent. That read-then-write is not a constraint: two callers can both read
 * "absent" and both write, and whether a duplicate is stopped then depended
 * entirely on each caller happening to claim its own row with an `updateMany`
 * before getting here. The callers still do that -- it is what keeps a lost
 * race a quiet no-op instead of an aborted transaction -- but it is a
 * courtesy, not the guarantee. The guarantee is the index.
 *
 * NO CALLER CATCHES DuplicateLedgerTransactionError, and that is a decision,
 * not an oversight. Every caller keys its transactionId on a row it has
 * already claimed -- WebhookEvent's unique (provider, providerEventId), Payout
 * DRAFT -> APPROVED, Refund REQUESTED -> APPROVED, Payment.escrowReleasedAt
 * IS NULL -- or, for createRefund, on a row it created a statement earlier,
 * and nothing in src/ ever moves any of those back. So a second post of the
 * same id is unreachable in normal operation, and a legitimate retry loses
 * that claim first and is answered by the caller itself (settled: false from
 * the webhook, InvalidPayoutStatusError, InvalidRefundStatusError, `false`
 * from the sweep), never by this.
 *
 * What is left is the case where a caller's claim and the ledger disagree
 * about money that has already moved. That stays loud: the webhook answers
 * 500 with the event unprocessed, so the provider's retry resumes the
 * settlement rather than believing it happened, and the sweep logs the one
 * payment and carries on with the rest. Absorbing the error at either caller
 * would put a twice-posted movement behind a handled path, which is the silent
 * no-op the read-then-write used to be.
 */
export async function postTransaction(
  tx: Prisma.TransactionClient,
  legs: LedgerLeg[],
  options: PostOptions = {},
): Promise<string> {
  assertLegsValid(legs);
  assertBalanced(legs);

  const transactionId = options.transactionId ?? randomUUID();

  try {
    await tx.ledgerEntry.createMany({
      data: legs.map((leg, legIndex) => ({
        account: leg.account,
        direction: leg.direction,
        amount: leg.amount,
        campaignId: leg.campaignId ?? null,
        volunteerTripId: leg.volunteerTripId ?? null,
        programId: leg.programId ?? null,
        memo: leg.memo ?? null,
        paymentId: options.paymentId ?? null,
        refundId: options.refundId ?? null,
        payoutId: options.payoutId ?? null,
        manualContributionId: options.manualContributionId ?? null,
        transactionId,
        // 0 claims the transactionId; the rest are ordinary legs. The index
        // is on the transactionId itself, not on a copy of it, so the claim
        // cannot drift from the id it claims.
        legIndex,
      })),
    });
  } catch (err) {
    // Postgres has put this transaction into an aborted state by now, so
    // there is nothing to do here but name what happened: the caller has to
    // roll its own transaction back, and it needs to know this was a
    // duplicate rather than a failure worth retrying.
    if (isPrismaUniqueConstraintViolation(err)) {
      throw new DuplicateLedgerTransactionError(transactionId);
    }
    throw err;
  }

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
 * What a Program has been credited with off-gateway, in rupiah
 * (CONTEXT.md, Program Balance).
 *
 * Its own query rather than a widened accountBalance, and it filters on
 * programId alone -- so a Campaign and a Program that happen to share a raw id
 * value cannot read each other's money, which is the same guarantee
 * campaignBalance and tripBalance give each other.
 *
 * Not withdrawable by anything: there is no Payout against a Program, so this
 * figure exists to be reported and to gate a reversal, not to be spent.
 */
export async function programBalance(tx: Prisma.TransactionClient, programId: string): Promise<number> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ['direction'],
    where: { account: 'PROGRAM_BALANCE', programId },
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
 * The proportional, capped share of one Payment-level fee (Provider Fee or
 * Platform Fee) attributable to one Refund's `targetAmount`, rounded up --
 * capped so the SUM of every non-REJECTED/FAILED Refund's portion on the
 * same Payment, taken in creation order, never exceeds `feeTotal`. Without
 * this cumulative cap, two 50_000 partial refunds on a Gross 100_000 /
 * fee 3_333 Payment would each independently round their own 1_666.5 up to
 * 1_667, recognizing 3_334 total -- one rupiah more than the Payment ever
 * actually carried.
 *
 * Shared by providerFeePortionFor and platformFeePortionFor below: both
 * fees are split off a Payment's `amount` by the identical rule, so the
 * math lives once. `priorAmounts` must be every OTHER non-REJECTED/FAILED
 * Refund's `amount` on this same Payment, in ascending `createdAt` order,
 * excluding the Refund whose portion is being computed now.
 */
function feePortionOf(feeTotal: number, paymentAmount: number, targetAmount: number, priorAmounts: number[]): number {
  let recognized = 0;
  for (const priorAmount of priorAmounts) {
    const raw = ceilMulDiv(feeTotal, priorAmount, paymentAmount);
    recognized += Math.min(raw, Math.max(0, feeTotal - recognized));
  }
  const raw = ceilMulDiv(feeTotal, targetAmount, paymentAmount);
  return Math.min(raw, Math.max(0, feeTotal - recognized), targetAmount);
}

/** The Provider Fee portion of one Refund's `amount` -- see feePortionOf above. */
export function providerFeePortionFor(
  payment: { amount: number; providerFee: number },
  refundAmount: number,
  priorAmounts: number[],
): number {
  return feePortionOf(payment.providerFee, payment.amount, refundAmount, priorAmounts);
}

/**
 * The Platform Fee portion of one Refund's `amount` (prd-compliance 17) --
 * see feePortionOf above for the shared rule. A refunded Payment's pool
 * (ESCROW_HOLD or the withdrawable balance) only ever held
 * `gross - providerFee - platformFee` (paymentSettledLegs), so a Refund
 * must return the Platform Fee's share the same proportional way it
 * already returns the Provider Fee's -- otherwise the pool is debited more
 * than it was ever credited, for exactly the Platform Fee amount.
 *
 * `payment.platformFee` is read as 0 when null/undefined, the same way
 * every other reader of this field treats its absence (POST
 * /api/webhooks/[provider] does the same for providerFee) -- a Payment that
 * predates this column, or a Trip Fee Payment, carries no Platform Fee.
 */
export function platformFeePortionFor(
  payment: { amount: number; platformFee: number | null | undefined },
  refundAmount: number,
  priorAmounts: number[],
): number {
  return feePortionOf(payment.platformFee ?? 0, payment.amount, refundAmount, priorAmounts);
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
 *   DEBIT  GATEWAY_CLEARING  gross                     money arrived at the provider
 *   CREDIT ESCROW_HOLD       gross - providerFee -      the campaign's, not yet
 *                              platformFee               withdrawable
 *   CREDIT PROVIDER_FEE      providerFee               what the provider kept
 *   CREDIT PLATFORM_FEE      platformFee               what the platform kept (prd-compliance 17)
 *
 * Three things this gets deliberately right.
 *
 * The campaign is credited the NET of BOTH fees. Crediting gross and hoping
 * either fee is deducted later is how a campaign ends up able to withdraw
 * money that never arrived.
 *
 * And it lands in ESCROW_HOLD, not CAMPAIGN_BALANCE. Settlement means the
 * provider has the money, not that the dispute window has closed; paying it
 * straight out means chasing a campaigner for a chargeback later.
 * escrowReleaseLegs moves it across when the hold matures.
 *
 * `platformFee` is never computed here. It is resolved once, at Payment
 * creation (resolvePlatformFeeBasis + computePlatformFee, ./platform-fee*.ts)
 * and frozen on Payment.platformFee -- this function only posts the number
 * it is given, so a later change to the rate can never alter what an
 * already-created Payment promised the Donor. It defaults to 0 so a Trip Fee
 * settlement, which never carries a Platform Fee (CONTEXT.md, Trip Fee), can
 * call this without passing it at all.
 */
export function paymentSettledLegs(params: {
  subject: LedgerSubject;
  grossAmount: number;
  providerFee: number;
  platformFee?: number;
}): LedgerLeg[] {
  const { subject, grossAmount, providerFee, platformFee = 0 } = params;
  if (providerFee < 0) {
    throw new InvalidLedgerLegError(`providerFee ${providerFee} must not be negative.`);
  }
  if (platformFee < 0) {
    throw new InvalidLedgerLegError(`platformFee ${platformFee} must not be negative.`);
  }
  if (providerFee + platformFee > grossAmount) {
    throw new InvalidLedgerLegError(
      `providerFee ${providerFee} plus platformFee ${platformFee} must not exceed the gross amount ${grossAmount}.`,
    );
  }
  const net = grossAmount - providerFee - platformFee;

  const legs: LedgerLeg[] = [
    { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: grossAmount },
    { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: net, ...subjectFk(subject) },
  ];
  // Omitted entirely when zero: a zero-amount leg is rejected by
  // assertLegsValid, and a fee-free provider (or a Payment with no Platform
  // Fee) is a legitimate case.
  if (providerFee > 0) {
    legs.push({ account: 'PROVIDER_FEE', direction: 'CREDIT', amount: providerFee });
  }
  if (platformFee > 0) {
    legs.push({ account: 'PLATFORM_FEE', direction: 'CREDIT', amount: platformFee });
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
 *   CREDIT REFUND_CLEARING amount     (always, full Gross to the donor)
 *   DEBIT  FROZEN_BALANCE  amount     (always, closes the freeze)
 *   DEBIT  REFUND_COST     shortfall  (omitted when zero)
 *   CREDIT <source>        shortfall  (omitted when zero -- platform tops the
 *                                       pool back up for a genuine shortfall)
 *
 * WHY GATEWAY_CLEARING IS NOT CREDITED HERE (prd-compliance 28c). It is
 * tempting to close this by crediting the Provider Balance with the Gross
 * going back to the Donor, and it is wrong, for the same reason
 * payoutInstructedLegs stops at PAYOUT_CLEARING: a Refund is approved by
 * one Admin and *completed* by a different one (CONTEXT.md, Refund), so
 * approval is an internal decision, not a movement of money. The Donor is
 * paid when the Refund completes, and it is paid out of the Provider
 * Balance -- which is what refundPaidLegs (below) posts. Crediting it here
 * would claim the money had left the payment provider at a moment when
 * nobody has sent it, and with no completion step in this codebase yet
 * (ticket 32) nothing would ever correct the claim.
 *
 * The fees this Refund returns are not left behind in the Provider Balance
 * as money owed to somebody, either. They left at freeze time, to accounts
 * named for exactly what they are: the Platform Fee back to PLATFORM_FEE
 * (the platform's own retained revenue, handed back), and the Provider Fee
 * the provider will not return to REFUND_COST, the account named for the
 * platform carrying it (ADR 0007). So the whole Gross is the Donor's claim
 * by the time this runs, and the Campaign's own credit is untouched.
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

/**
 * Money that arrived outside the payment gateway (CONTEXT.md, Manual
 * Contribution; PRD FFI-07c).
 *
 *   DEBIT  MANUAL_INTAKE_CLEARING  amount   the platform physically has it
 *   CREDIT CAMPAIGN_BALANCE        amount   a Campaign, withdrawable at once
 *            -- or --
 *   CREDIT PROGRAM_BALANCE         amount   a Program, withdrawable by nothing
 *
 * Three things this deliberately does NOT do, and each of them is a rule
 * rather than an omission:
 *
 *  - It does not touch ESCROW_HOLD. The hold exists to give a chargeback time
 *    to arrive while the money is still the platform's problem; a bank
 *    transfer that already cleared has no provider to charge back through, so
 *    holding it would strand real money for seven days for nothing.
 *
 *  - It credits neither PROVIDER_FEE nor PLATFORM_FEE. There was no provider
 *    charge to keep and no online gift to charge a percentage of, so the
 *    credited amount is exactly the rupiah that arrived. Crediting gross is
 *    therefore the same figure here as net is on a settled Payment.
 *
 *  - It is idempotent per Manual Contribution, keyed on the contribution's own
 *    id by the caller, so a retried approval cannot credit twice.
 */
export function manualContributionReceivedLegs(params: {
  subject: ManualContributionSubject;
  amount: number;
}): LedgerLeg[] {
  const { subject, amount } = params;
  return [
    { account: 'MANUAL_INTAKE_CLEARING', direction: 'DEBIT', amount },
    { account: manualContributionBalanceAccount(subject), direction: 'CREDIT', amount, ...manualContributionFk(subject) },
  ];
}

/**
 * A payout's transfer confirmed out, recorded by the second Admin with
 * proof of transfer.
 *
 *   DEBIT  PAYOUT_CLEARING   amount   no longer in flight
 *   CREDIT GATEWAY_CLEARING  amount   no longer at the payment provider
 *
 * Posted at COMPLETION, not at approval, and it takes no `subject`: both
 * accounts are platform-level. The money stops being anybody's the moment
 * it is instructed (that is what stops a balance being paid twice), so what
 * is left to record here is where it went -- out of the platform's own
 * books entirely, and specifically out of the Provider Balance.
 *
 * GATEWAY_CLEARING is CONTEXT.md's Provider Balance: debited on every
 * settlement by paymentSettledLegs (above), and credited only by the two
 * withdrawal paths below -- this leg, and refundPaidLegs. Until those
 * existed the account grew by the full gross of every Donation forever and
 * the books claimed a pot at the provider larger than could ever exist.
 * This is one of the two credits that closes it, and it is what finally
 * makes ADR 0011's invariant statable: the Provider Balance equals
 * GATEWAY_CLEARING less what an Admin has withdrawn.
 *
 * Why the provider at all, when the money went to a bank? Because the
 * withdrawal is made by hand in the provider's dashboard, straight to the
 * Fundraiser's verified Bank Account (ADR 0006: Sumopod has no
 * disbursement API, and the two-person rule means the transfer happens on
 * the second Admin's own action). So the money never lands in a platform
 * bank account on its way out; it goes from the Provider Balance to the
 * Fundraiser, and the Provider Balance is the account that shrinks.
 */
export function payoutCompletedLegs(params: { amount: number }): LedgerLeg[] {
  return [
    { account: 'PAYOUT_CLEARING', direction: 'DEBIT', amount: params.amount },
    { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: params.amount },
  ];
}

/**
 * The same movement taken back: an APPROVED Manual Contribution that turned
 * out to be wrong.
 *
 *   DEBIT  CAMPAIGN_BALANCE        amount   -- or PROGRAM_BALANCE
 *   CREDIT MANUAL_INTAKE_CLEARING  amount   the money leaves the books again
 *
 * The exact mirror image of manualContributionReceivedLegs, and a NEW pair of
 * rows rather than a deletion or an edit of the original ones. A correction
 * that removed the credit would leave no trace that money had ever been
 * recorded, which is the one thing a ledger exists to prevent. Whether this
 * may be posted at all -- the balance has to still hold the amount, i.e. no
 * Payout has spent it -- is judged by the caller under the subject's row
 * lock, because balances are derived by summing entries and have no row of
 * their own to lock.
 */
export function manualContributionReversedLegs(params: {
  subject: ManualContributionSubject;
  amount: number;
}): LedgerLeg[] {
  const { subject, amount } = params;
  return [
    { account: manualContributionBalanceAccount(subject), direction: 'DEBIT', amount, ...manualContributionFk(subject) },
    { account: 'MANUAL_INTAKE_CLEARING', direction: 'CREDIT', amount },
  ];
}

/**
 * A refund actually PAID to the Donor, by the third Admin who completes it.
 *
 *   DEBIT  REFUND_CLEARING   amount   the Donor is owed nothing further
 *   CREDIT GATEWAY_CLEARING  amount   no longer at the payment provider
 *
 * The Refund-side twin of a Payout's completion leg, and the withdrawal path
 * the returned fees ride out on. GATEWAY_CLEARING is CONTEXT.md's Provider
 * Balance: debited with the full Gross of every settlement, and until a
 * movement like this one existed nothing took a refunded Donation back out of
 * it. The account then claimed a pot at the provider holding money that had
 * already been handed to Donors, on top of every Gross ever received.
 *
 * The FULL Gross leaves, not just the Campaign's net share of it, and that is
 * the whole point rather than a rounding. A Refund returns the Gross
 * (CONTEXT.md, Refund; ADR 0007) while the Campaign only ever gave up
 * `amount - platformFeePortion - providerFeePortion`, so the Provider Balance
 * carried the difference and the Donor is paid out of it. The platform's own
 * half of that difference is already on named accounts by the time this runs
 * -- the returned Platform Fee on PLATFORM_FEE and the Provider Fee the
 * provider will not return on REFUND_COST, both debited at freeze time by
 * refundRequestedLegs -- so the money that leaves here is fully accounted for
 * and none of it is silently absorbed.
 *
 * It takes no `subject`: both accounts are platform-level. A Trip Fee Refund
 * drains the Provider Balance exactly the same way, because the money came
 * from the same pot whatever it was collected for.
 *
 * NOT POSTED YET. No code moves a Refund past APPROVED today -- the
 * COMPLETED transition is ticket 32 (CONTEXT.md, Refund: created by one
 * Admin, approved by another, completed by a third, with proof of transfer).
 * It belongs here rather than in refundApprovedLegs, because approval is an
 * internal decision that moves no money: posting this at approval would
 * claim the money had left the payment provider before anybody sent it, and
 * with no completion step there is nothing that would ever correct it. This
 * builder exists so that when ticket 32 writes that step it cannot assemble
 * the legs by hand and credit the wrong account.
 */
export function refundPaidLegs(params: { amount: number }): LedgerLeg[] {
  return [
    { account: 'REFUND_CLEARING', direction: 'DEBIT', amount: params.amount },
    { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: params.amount },
  ];
}
