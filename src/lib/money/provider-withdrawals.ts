import { isBetaSandbox } from '@/lib/deploy-environment';
import type { Prisma, PrismaClient, ProviderWithdrawal } from '@/generated/prisma/client';
import { collectionAccountWithdrawalLegs, MAX_RUPIAH_AMOUNT, postTransaction, providerBalances, type ProviderBalance } from './ledger';
import { isPrismaUniqueConstraintViolation } from '@/lib/prisma-errors';
import { canonicalPaymentProviderName, UnknownPaymentProviderError } from '@/lib/payments/provider-names';
import {
  ProviderWithdrawalAmountError,
  ProviderWithdrawalDuplicateError,
  ProviderWithdrawalInputError,
  ProviderWithdrawalNotFoundError,
  ProviderWithdrawalProofRequiredError,
} from './errors';

/**
 * The sweep from a Payment Provider to a Collection Account, and the
 * reconciliation that reads it back (prd-compliance 35; PRD FFI-07; ADR 0011).
 *
 * This is the ticket's reason to exist. Until now the Provider Balance was
 * debited on every Settlement and the only things crediting it paid money OUT
 * to a Donor or a Fundraiser; nothing recorded the movement of the platform's
 * own money from where the provider holds it to where the Collecting Entity can
 * bank it. So "the money reached the bank" was an assumption, and a
 * reconciliation could not tell an assumption from a fact.
 *
 * WHAT IS RECORDED, and why each part is required:
 *
 *  - `provider` and `reference` come from the provider's own dashboard. The
 *    reference is UNIQUE, and that is the whole idempotency story: the provider
 *    issues one reference per disbursement, so the same reference arriving
 *    twice is the same money being claimed twice. The claim is the index, not a
 *    read first -- two admins recording the same dashboard entry at the same
 *    moment would both read "absent", and only the index stops the second one
 *    from taking the money out of the pot a second time.
 *  - `providerBalanceBefore` and `providerBalanceAfter` are the two readings
 *    either side of the movement. Both required, and this is the part that makes
 *    the report mean anything: a reading taken either side of a movement is a
 *    reading of the SAME instant as the ledger, so the two can be subtracted
 *    from each other honestly. A reading from any other moment cannot, which is
 *    why Payout.approvedProviderBalance is never a reconciliation datum.
 *
 * WHY THE TWO READINGS ARE NOT REQUIRED TO DIFFER BY `amount`. They legitimately
 * do not when the provider moved money on its own across the same window -- a fee
 * on the transfer, a chargeback that landed. Forcing them to agree would refuse
 * an honest record of exactly the event this module exists to surface, and
 * quietly adjusting either figure to make them agree would destroy the evidence
 * that something at the provider did not match the books. The gap is reported,
 * per sweep and in total, and nobody corrects it.
 *
 * WHY THERE IS NO TWO-PERSON RULE HERE. The two-person rule on a Payout exists
 * because one person could otherwise send a Campaign's money to themselves, and
 * on a Manual Contribution because one Admin could invent a donation. Neither
 * risk is present: this money goes to a bank account of an entity, not to a
 * person, and the account holder is recorded. Recorded, not decided -- a sweep to
 * the platform's own account would be a different question, and
 * collectingEntityId being nullable is how this module leaves it open rather than
 * answering it. Whether a sweep should need two people is the owner's call; see
 * the ticket's Comments.
 *
 * Callers establish the ADMIN Capacity (the route does, through
 * withAssignmentCheck); this takes the acting id because it records who did it.
 */

export {
  ProviderWithdrawalAmountError,
  ProviderWithdrawalDuplicateError,
  ProviderWithdrawalInputError,
  ProviderWithdrawalNotFoundError,
  ProviderWithdrawalProofRequiredError,
};

const MAX_TEXT_LENGTH = 500;

export interface RecordProviderWithdrawalParams {
  /**
   * Which Payment Provider the Admin read the dashboard on. Typed as the
   * dashboard spells it; resolved through the provider registry before it
   * touches money, so it is the same string the webhooks stamp.
   */
  provider: string;
  /** The provider's own reference for this disbursement. The claim. */
  reference: string;
  /** Whole rupiah taken out of the Provider Balance. Positive. */
  amount: number;
  /** The account holder as the provider has it registered. */
  destinationName: string;
  /**
   * The registered Collecting Entity whose account received the money, when it
   * is one. Optional on purpose -- see the module comment.
   */
  collectingEntityId?: string | null;
  /** What the provider's dashboard showed immediately before the sweep. */
  providerBalanceBefore: number;
  /** What it showed immediately after. */
  providerBalanceAfter: number;
  /** Where the evidence is. Required, like a Payout's proofImage. */
  proofReference: string;
  recordedById: string;
}

function cleanText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProviderWithdrawalInputError(`${field} wajib diisi.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new ProviderWithdrawalInputError(`${field} paling panjang ${MAX_TEXT_LENGTH} karakter.`);
  }
  return trimmed;
}

/**
 * The provider's name as the ledger already knows it, from whatever the Admin
 * typed on the form.
 *
 * The name is a join key here, not a label: the Provider Balance is split by
 * exact string equality, and the settlements filling it were stamped by the
 * webhook route with the provider's own canonical name. So free text would let
 * "Sumopod" -- the spelling on the dashboard -- put a sweep's credit in a
 * second pot, and the report would show two providers, each reconciling
 * exactly, for one provider. Resolving through the registry is what keeps this
 * module from being the second place that names a provider.
 */
function canonicalProviderName(value: unknown): string {
  const typed = cleanText(value, 'Nama penyedia pembayaran');
  try {
    return canonicalPaymentProviderName(typed);
  } catch (err) {
    if (err instanceof UnknownPaymentProviderError) {
      throw new ProviderWithdrawalInputError(
        `Penyedia pembayaran tidak dikenal: ${typed}. Gunakan nama penyedia yang terdaftar.`,
      );
    }
    throw err;
  }
}

function assertAmount(value: unknown, field: string, rule: 'positive' | 'nonNegative'): number {
  const valid =
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_RUPIAH_AMOUNT &&
    (rule === 'positive' ? value > 0 : true);
  if (!valid) throw new ProviderWithdrawalAmountError(field, rule);
  return value;
}

function cleanProofReference(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProviderWithdrawalProofRequiredError();
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new ProviderWithdrawalInputError(
      `Bukti penarikan paling panjang ${MAX_TEXT_LENGTH} karakter.`,
    );
  }
  return trimmed;
}

/**
 * One Admin records a sweep from a payment provider to a Collection Account:
 * the row, and the balanced journal that moves the money, in one transaction.
 *
 * Order matters and is the same shape as createRefund's: the row is created a
 * statement before the post, and the transactionId is derived from it. The row's
 * creation is the claim (its unique `reference` index), so a retry of the same
 * disbursement is refused there and never reaches the ledger. The ledger's own
 * claim on the transactionId is then a second, independent guard on the same
 * post -- and because this function does NOT catch DuplicateLedgerTransactionError,
 * a genuine write failure still surfaces as a failure rather than being
 * swallowed into a "already done" answer. Nothing moves either state back, so a
 * second post of the same id is unreachable in normal operation.
 */
export async function recordProviderWithdrawal(
  prisma: PrismaClient,
  params: RecordProviderWithdrawalParams,
): Promise<ProviderWithdrawal> {
  // The sweep to the bank is a real-money movement with no mode of its own
  // (ticket 94): it is closed while the beta marker is on, so nothing in the
  // beta can be mistaken for, or mixed into, a real withdrawal.
  if (isBetaSandbox()) {
    throw new ProviderWithdrawalInputError(
      'Penarikan dari penyedia tidak tersedia selama mode Beta (BETA_SANDBOX aktif): tidak ada uang nyata yang boleh ditarik.',
    );
  }
  const provider = canonicalProviderName(params.provider);
  const reference = cleanText(params.reference, 'Referensi penarikan dari penyedia');
  const destinationName = cleanText(params.destinationName, 'Nama pemilik rekening tujuan');
  const amount = assertAmount(params.amount, 'Nominal penarikan', 'positive');
  const providerBalanceBefore = assertAmount(
    params.providerBalanceBefore,
    'saldo sebelum penarikan',
    'nonNegative',
  );
  const providerBalanceAfter = assertAmount(
    params.providerBalanceAfter,
    'saldo setelah penarikan',
    'nonNegative',
  );
  const proofReference = cleanProofReference(params.proofReference);
  const recordedById = cleanText(params.recordedById, 'Admin yang mencatat');
  const collectingEntityId =
    params.collectingEntityId === undefined || params.collectingEntityId === null
      ? null
      : cleanText(params.collectingEntityId, 'Collecting Entity');

  // Every input checked before the transaction opens, because these are
  // properties of the request and not of any row: no amount of validation after
  // this point can turn a blank proof into a good one.
  return prisma.$transaction(async (tx) => {
    if (collectingEntityId) {
      // A collecting entity that is not registered would leave the row naming
      // an id that resolves to nothing, and "whose account received this
      // money" is the one question this row exists to answer.
      const entity = await tx.partnerOrganisation.findUnique({
        where: { id: collectingEntityId },
        select: { id: true },
      });
      if (!entity) throw new ProviderWithdrawalNotFoundError(collectingEntityId);
    }

    let withdrawal: ProviderWithdrawal;
    try {
      withdrawal = await tx.providerWithdrawal.create({
        data: {
          provider,
          reference,
          amount,
          destinationName,
          collectingEntityId,
          providerBalanceBefore,
          providerBalanceAfter,
          proofReference,
          recordedById,
        },
      });
    } catch (err) {
      // Only the reference is unique on this table, so a P2002 here can only
      // mean the claim is already taken. Asked by code rather than by index
      // name for the same reason postTransaction does: `code` is the part of
      // Prisma's error shape that does not move with a driver adapter.
      if (isPrismaUniqueConstraintViolation(err)) {
        throw new ProviderWithdrawalDuplicateError(reference);
      }
      throw err;
    }

    await postTransaction(
      tx,
      collectionAccountWithdrawalLegs({ amount }),
      {
        providerWithdrawalId: withdrawal.id,
        // Stamped on both legs, so the Provider Balance shrinks for THIS
        // provider and the movement can be attributed to this recorded sweep.
        provider,
        transactionId: `provider-withdrawal-${withdrawal.id}`,
      },
    );

    return withdrawal;
  });
}

/** One recorded sweep, read back with the gap it leaves between the books and the dashboard. */
export interface WithdrawalReconciliation {
  withdrawalId: string;
  provider: string;
  reference: string;
  amount: number;
  destinationName: string;
  collectingEntityId: string | null;
  providerBalanceBefore: number;
  providerBalanceAfter: number;
  /** What the provider's own balance fell by across this sweep. */
  providerMovedBy: number;
  /**
   * providerMovedBy - amount. ZERO means the provider and the books agree about
   * this sweep. Non-zero means the provider moved money nobody recorded -- a
   * fee, a chargeback, a disbursement made outside the platform -- and it is
   * reported, never corrected.
   */
  difference: number;
  recordedAt: string;
}

/** One provider's Provider Balance, and every recorded sweep of it. */
export interface ProviderReconciliation {
  provider: string;
  /**
   * The ledger's own pot for this provider. A FLOOR, not the whole Provider
   * Balance: movements naming no provider (a completed Payout, a paid Refund)
   * are deliberately not folded in. See ledger.ts's providerBalances.
   */
  pot: ProviderBalance;
  /** What has been swept to the bank for this provider, per the ledger. */
  withdrawn: number;
  /** What the provider's own balance fell by, summed over the same sweeps. */
  providerMovedBy: number;
  /**
   * providerMovedBy - withdrawn, summed. The systematic divergence: what the
   * provider did that this platform did not record. Reported per sweep as well,
   * so one bad reading among many is identifiable rather than averaged away.
   *
   * NEVER corrected, and never used to move money. A reconciliation job that
   * fixes its own findings destroys the evidence of what went wrong, and in a
   * money system that evidence is the only way to learn what broke.
   */
  difference: number;
  withdrawals: WithdrawalReconciliation[];
}

/**
 * The per-provider reconciliation: what the ledger says left each provider for
 * the bank, against what each provider's own dashboard said left it.
 *
 * A provider appears only if somebody recorded a sweep of it. A provider with
 * money sitting at it and no sweep recorded is NOT reported as reconciled and
 * is NOT reported as clean -- it is simply absent, because there is no reading
 * to reconcile against and inventing a zero would be the quietest possible lie
 * this module could tell. A caller that wants to see those too reads
 * providerBalances (./ledger.ts) alongside this, which reports every pot
 * including the unnamed bucket.
 */
export async function reconcileProviderBalances(
  tx: Prisma.TransactionClient,
): Promise<ProviderReconciliation[]> {
  const withdrawals = await tx.providerWithdrawal.findMany({ orderBy: { recordedAt: 'asc' } });
  if (withdrawals.length === 0) return [];

  const pots = await providerBalances(tx);
  const potOf = (provider: string): ProviderBalance =>
    pots.find((p) => p.provider === provider) ?? { provider, debited: 0, credited: 0, balance: 0 };

  // Keyed by provider, not in findMany order: two sweeps of one provider are
  // one line of this report, and the report's shape must not depend on the
  // order a query happens to answer in.
  const byProvider = new Map<string, ProviderReconciliation>();
  for (const withdrawal of withdrawals) {
    const providerMovedBy = withdrawal.providerBalanceBefore - withdrawal.providerBalanceAfter;
    const row: WithdrawalReconciliation = {
      withdrawalId: withdrawal.id,
      provider: withdrawal.provider,
      reference: withdrawal.reference,
      amount: withdrawal.amount,
      destinationName: withdrawal.destinationName,
      collectingEntityId: withdrawal.collectingEntityId,
      providerBalanceBefore: withdrawal.providerBalanceBefore,
      providerBalanceAfter: withdrawal.providerBalanceAfter,
      providerMovedBy,
      difference: providerMovedBy - withdrawal.amount,
      recordedAt: withdrawal.recordedAt.toISOString(),
    };

    let report = byProvider.get(withdrawal.provider);
    if (!report) {
      report = {
        provider: withdrawal.provider,
        pot: potOf(withdrawal.provider),
        withdrawn: 0,
        providerMovedBy: 0,
        difference: 0,
        withdrawals: [],
      };
      byProvider.set(withdrawal.provider, report);
    }
    report.withdrawn += withdrawal.amount;
    report.providerMovedBy += providerMovedBy;
    report.difference += row.difference;
    report.withdrawals.push(row);
  }

  // Array.from rather than spreading the iterator: this repo's tsconfig target
  // predates downlevel iteration, the same reason findUnbalancedTransactions
  // (./ledger.ts) does it this way. Map preserves insertion order, so the
  // providers come out in the order the sweeps were recorded, which is the
  // order a reader wants -- and `withdrawals` within each one is in
  // recordedAt order because the query asked for it.
  return Array.from(byProvider.values());
}
