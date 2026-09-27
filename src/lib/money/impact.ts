import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Impact & Transparency: where every rupiah a Donor handed over has ended up
 * (ticket 25; PRD FFI-14).
 *
 * Everything here is summed out of the ledger. `Campaign.collectedAmount` is
 * never read: it is a denormalised display figure (src/lib/money/ledger.ts's
 * own doc comment says the ledger is right when the two disagree), and a
 * transparency page built on it would be quoting the number it is supposed to
 * be checking.
 *
 * **The six lines.** `collected` is the Gross of every settled Payment plus
 * the Manual Contributions still standing (prd-compliance 34), and it is split
 * into exactly six destinations, which is what a visitor is shown:
 *
 *   1. disbursedToFundraisers     instructed out of the Campaign Balance
 *   2. returnedToDonors           handed back, at Gross
 *   3. heldInEscrowHold           still inside the dispute window, plus the
 *                                 Frozen Balance of Refunds not yet paid out
 *   4. availableInCampaignBalance withdrawable now
 *   5. platformFeeRetained        Platform Fee the platform kept
 *   6. providerFeeKept            Provider Fee the provider kept
 *
 * They are not six independent figures stapled together; they are one
 * conservation law read six ways, and the reader asserts it rather than
 * trusting it. Double entry is what makes the assertion cheap: every movement
 * of a Donor's money is a balanced transaction, so
 *
 *   collected = held + available + disbursed + returned + fees kept
 *
 * holds for any history at all -- unless something moved money that never
 * came from a settled Payment (a Payout out of a Campaign funded before the
 * money layer existed, say). That case is a real data-integrity incident, so
 * `impactBreakdown` throws ImpactDoesNotReconcileError rather than serving six
 * numbers that silently do not add up. The PRD asks for exactly that ("the
 * page fails loudly rather than displaying numbers that do not reconcile").
 *
 * **Two things deliberately sit outside those six lines**, because they are
 * the platform's own money and not part of what was collected (PRD FFI-14):
 *
 * - `platformCost.unrecoveredProviderFee` -- the Provider Fee a Gross Refund
 *   never returns, which the platform absorbs (ADR 0007). It is why
 *   `providerFeeKept` reads 0 for a fully refunded Donation: the provider did
 *   not hand that money back, so it is not money the provider still holds.
 * - `platformCost.uncoveredRefunds` -- the part of a Refund the Campaign could
 *   no longer cover because its money had already been paid out. Per the PRD
 *   this does NOT reduce the disbursed line; it is reported here instead.
 *
 * And two figures read zero until the models behind them exist, rather than
 * being guessed at: `beneficiaries` (Usage Report, a later ticket) and
 * `manualContributions` (a Manual Contribution no Admin has recorded, or only
 * ones that have since been reversed). `notes` carries both caveats out to the
 * page so a visitor is told why a number is zero.
 */

export const IMPACT_LINES = [
  {
    key: 'disbursedToFundraisers',
    label: 'Tersalurkan ke Fundraiser lewat Payout',
  },
  {
    key: 'returnedToDonors',
    label: 'Dikembalikan ke Donor',
  },
  {
    key: 'heldInEscrowHold',
    label: 'Ditahan di Escrow Hold, termasuk yang dibekukan menunggu Refund',
  },
  {
    key: 'availableInCampaignBalance',
    label: 'Tersedia di Campaign Balance',
  },
  {
    key: 'platformFeeRetained',
    label: 'Platform Fee yang tidak dikembalikan',
  },
  {
    key: 'providerFeeKept',
    label: 'Provider Fee yang diterima penyedia pembayaran',
  },
] as const;

export type ImpactLineKey = (typeof IMPACT_LINES)[number]['key'];

export interface ImpactLine {
  key: ImpactLineKey;
  label: string;
  amount: number;
}

export interface ImpactBreakdown {
  /** Gross of every settled Payment, plus Manual Contributions. Never `collectedAmount`. */
  collected: number;
  lines: ImpactLine[];
  /**
   * Money the platform spent absorbing Refunds. Shown apart from `collected`
   * on purpose: it was never part of what the Donors collected, and folding
   * it into the six lines would make the page claim the Campaign spent money
   * that had already been paid out.
   */
  platformCost: {
    unrecoveredProviderFee: number;
    uncoveredRefunds: number;
  };
  /** Disbursed but not yet marked COMPLETED (a later ticket adds that step). */
  disbursedNotYetCompleted: number;
  /**
   * Money that arrived outside the gateway and is counted in `collected`,
   * marked apart so it is never read as a Donation. Zero until an Admin
   * records one; excludes anything already reversed, and excludes
   * Program-targeted money (a Program is not a Campaign, and FFI-14's CSR line
   * is a later ticket).
   */
  manualContributions: number;
  /** Zero until Usage Report exists. */
  beneficiaries: number;
  /** The location filter as asked for, or null for the whole platform. */
  location: string | null;
  notes: string[];
}

export class ImpactDoesNotReconcileError extends Error {
  constructor(
    readonly collected: number,
    readonly linesTotal: number,
  ) {
    super(
      `The six Impact lines total ${linesTotal} but the ledger says ${collected} was collected. ` +
        'Refusing to publish a breakdown that does not add up.',
    );
    this.name = 'ImpactDoesNotReconcileError';
  }
}

/**
 * A Payout that has been instructed out of the Campaign Balance
 * (payoutInstructedLegs, ./ledger.ts) but not yet marked COMPLETED with proof
 * of transfer -- a step no code writes yet. Its money has already left, so it
 * belongs in the disbursed line; this is only here so the page can say how
 * much of that figure is still unconfirmed.
 */
const PAYOUT_AWAITING_COMPLETION = ['APPROVED', 'PROCESSING'];

type GroupedSum = Map<string, number>;

/** Folds `groupBy({ by: ['account','direction'] })` rows into `account:DIRECTION` -> amount. */
function totalsOf(rows: Array<{ account: string; direction: string; _sum: { amount: number | null } }>): GroupedSum {
  const totals: GroupedSum = new Map();
  for (const row of rows) {
    totals.set(`${row.account}:${row.direction}`, (totals.get(`${row.account}:${row.direction}`) ?? 0) + (row._sum.amount ?? 0));
  }
  return totals;
}

function sum(totals: GroupedSum, key: string): number {
  return totals.get(key) ?? 0;
}

/** Credits minus debits: how much a subject-scoped account holds right now. */
function balance(totals: GroupedSum, account: string): number {
  return sum(totals, `${account}:CREDIT`) - sum(totals, `${account}:DEBIT`);
}

export async function impactBreakdown(
  db: PrismaClient,
  options: { location?: string | null } = {},
): Promise<ImpactBreakdown> {
  const location = options.location?.trim() ? options.location.trim() : null;

  return db.$transaction(async (tx) => {
    // Demo Campaigns (CONTEXT.md, Demo Campaign) are excluded before anything
    // is counted: their figures are fixture data with no ledger behind them
    // by design, and quoting them would inflate every number on the page.
    // Campaign.collectedAmount is never read, at any point.
    const campaigns = await tx.campaign.findMany({
      where: {
        isDemo: false,
        ...(location ? { location: { contains: location, mode: 'insensitive' as const } } : {}),
      },
      select: { id: true },
    });
    const campaignIds = campaigns.map((c) => c.id);

    // Platform-level accounts (PROVIDER_FEE, PLATFORM_FEE, REFUND_CLEARING,
    // REFUND_COST, PAYOUT_CLEARING) carry no campaignId -- assertLegsValid in
    // ./ledger.ts refuses one -- so they are attributed to a Campaign through
    // the Payment, Refund or Payout each leg names, the same way
    // src/app/api/admin/reconcile/route.ts attributes PROVIDER_FEE. The lookup
    // lists below are what makes that attribution possible.
    const payments = await tx.payment.findMany({
      where: { donation: { campaignId: { in: campaignIds } } },
      select: { id: true },
    });
    const paymentIds = payments.map((p) => p.id);

    const refunds = await tx.refund.findMany({
      where: { paymentId: { in: paymentIds } },
      select: { id: true },
    });
    const refundIds = refunds.map((r) => r.id);

    const payouts = await tx.payout.findMany({
      where: { campaignId: { in: campaignIds } },
      select: { id: true, amount: true, status: true },
    });
    const payoutIds = payouts.map((p) => p.id);

    // What each Campaign's own pools hold, and what a Refund put back into one.
    // The second query is the shortfall: refundApprovedLegs tops a drained
    // pool back up by CREDITING it, and only a leg carrying a refundId can be
    // that credit -- escrow releases carry a paymentId instead.
    const campaignPoolRows = await tx.ledgerEntry.groupBy({
      by: ['account', 'direction'] as const,
      where: { campaignId: { in: campaignIds } },
      _sum: { amount: true },
    });
    const campaignPools = totalsOf(campaignPoolRows);
    const refundShortfallRows = await tx.ledgerEntry.groupBy({
      by: ['account', 'direction'] as const,
      where: {
        campaignId: { in: campaignIds },
        refundId: { not: null },
        account: { in: ['ESCROW_HOLD', 'CAMPAIGN_BALANCE'] },
      },
      _sum: { amount: true },
    });
    const refundShortfall = totalsOf(refundShortfallRows);

    // Settlement, by Payment: the ESCROW_HOLD credit carries the net and both
    // fee credits the rest, so the three together are the Gross the Donors
    // paid -- read from the ledger, never from Payment.amount.
    const paymentFeeRows = await tx.ledgerEntry.groupBy({
      by: ['account', 'direction'] as const,
      where: {
        paymentId: { in: paymentIds },
        account: { in: ['ESCROW_HOLD', 'PROVIDER_FEE', 'PLATFORM_FEE'] },
      },
      _sum: { amount: true },
    });
    const byPayment = totalsOf(paymentFeeRows);

    // Refund outcomes, by Refund: what actually reached the Donor, the
    // Platform Fee it handed back, and the Provider Fee the platform absorbed
    // doing it. Read by refundId, not paymentId: postTransaction stamps a
    // refund's legs with the refund (PostOptions.refundId), never the payment.
    const refundOutcomeRows = await tx.ledgerEntry.groupBy({
      by: ['account', 'direction'] as const,
      where: {
        refundId: { in: refundIds },
        account: { in: ['REFUND_CLEARING', 'REFUND_COST', 'PLATFORM_FEE'] },
      },
      _sum: { amount: true },
    });
    const byRefund = totalsOf(refundOutcomeRows);

    const payoutRows = await tx.ledgerEntry.groupBy({
      by: ['account', 'direction'] as const,
      where: { payoutId: { in: payoutIds }, account: { in: ['PAYOUT_CLEARING'] } },
      _sum: { amount: true },
    });
    const byPayout = totalsOf(payoutRows);

    // Manual Contributions (CONTEXT.md, Manual Contribution; PRD FFI-14):
    // money an Admin recorded as arriving outside the gateway, credited
    // straight to the withdrawable balance with no Escrow Hold and neither
    // fee. Credits minus debits, so a contribution that was later reversed
    // falls out of both the collected figure and the marker on its own --
    // there is no status to remember to filter on, and the reversal is the
    // same balanced journal as every other correction in this ledger.
    //
    // Scoped to Campaign-targeted rows only (`campaignId in campaignIds`), and
    // that is the whole reason a Program's money cannot inflate a Campaign's
    // figure: a Program's entries carry no campaignId at all. FFI-14's
    // separate CSR line is a later ticket; until then this page is about
    // Campaigns, and saying so is better than mixing the two.
    const manualRows = await tx.ledgerEntry.groupBy({
      by: ['account', 'direction'] as const,
      where: {
        campaignId: { in: campaignIds },
        manualContributionId: { not: null },
        account: 'CAMPAIGN_BALANCE',
      },
      _sum: { amount: true },
    });
    const byManual = totalsOf(manualRows);

    const netSettled = sum(byPayment, 'ESCROW_HOLD:CREDIT');
    const providerFeeCharged = sum(byPayment, 'PROVIDER_FEE:CREDIT');
    const platformFeeCharged = sum(byPayment, 'PLATFORM_FEE:CREDIT');
    // The Platform Fee a Refund handed back: refundRequestedLegs DEBITs
    // PLATFORM_FEE with the refunded share, so the platform's retained fee is
    // what it took minus what it gave back.
    const platformFeeReturned = sum(byRefund, 'PLATFORM_FEE:DEBIT');
    const manualContributions = balance(byManual, 'CAMPAIGN_BALANCE');

    // Both halves of the conservation law move together: a Manual Contribution
    // is already inside `availableInCampaignBalance` (it is a CAMPAIGN_BALANCE
    // credit), so leaving it out of `collected` here would make the six lines
    // overshoot by exactly that amount and throw.
    const collected = netSettled + providerFeeCharged + platformFeeCharged + manualContributions;

    const returnedGross = sum(byRefund, 'REFUND_CLEARING:CREDIT');
    // REFUND_COST carries two different things (refundRequestedLegs debits
    // the Provider Fee share, refundApprovedLegs debits the shortfall), and
    // they are told apart by the pool credit that only the shortfall has.
    const uncoveredRefunds =
      sum(refundShortfall, 'ESCROW_HOLD:CREDIT') + sum(refundShortfall, 'CAMPAIGN_BALANCE:CREDIT');
    const unrecoveredProviderFee = sum(byRefund, 'REFUND_COST:DEBIT') - uncoveredRefunds;

    const amounts: Record<ImpactLineKey, number> = {
      disbursedToFundraisers: sum(byPayout, 'PAYOUT_CLEARING:CREDIT'),
      // A Refund is money that really went back, so it is shown at Gross --
      // except for the part no Campaign money covered, which is the platform's
      // loss rather than a return of collected funds (reported below).
      returnedToDonors: returnedGross - uncoveredRefunds,
      heldInEscrowHold: balance(campaignPools, 'ESCROW_HOLD') + balance(campaignPools, 'FROZEN_BALANCE'),
      availableInCampaignBalance: balance(campaignPools, 'CAMPAIGN_BALANCE'),
      platformFeeRetained: platformFeeCharged - platformFeeReturned,
      providerFeeKept: providerFeeCharged - unrecoveredProviderFee,
    };

    const linesTotal = IMPACT_LINES.reduce((total, line) => total + amounts[line.key], 0);
    if (linesTotal !== collected) {
      throw new ImpactDoesNotReconcileError(collected, linesTotal);
    }

    const disbursedNotYetCompleted = payouts
      .filter((p) => PAYOUT_AWAITING_COMPLETION.includes(p.status))
      .reduce((total, p) => total + p.amount, 0);

    return {
      collected,
      lines: IMPACT_LINES.map((line) => ({ ...line, amount: amounts[line.key] })),
      platformCost: { unrecoveredProviderFee, uncoveredRefunds },
      disbursedNotYetCompleted,
      // Money that arrived outside the gateway and is counted apart from
      // Donations, so a visitor is never told a bank transfer was a Donation.
      // Program-targeted money is deliberately not here -- see the groupBy
      // above; it has no Campaign to be part of.
      manualContributions,
      // Usage Report (CONTEXT.md) has no model yet either, so no beneficiary
      // has ever been counted. The PRD expects zero here until Fase 2.
      beneficiaries: 0,
      location,
      notes: [
        'Penerima manfaat dihitung dari Usage Report; belum ada satu pun Usage Report, jadi angkanya nol.',
        'Manual Contribution adalah dana yang masuk di luar payment gateway, dicatat Admin dengan bukti dan disetujui Admin kedua; masuk ke terkumpul tanpa biaya provider maupun platform, dan yang sudah dibalikkan tidak dihitung.',
        'Platform Fee dan Provider Fee adalah uang platform dan penyedia, bukan bagian dari dana Campaign.',
      ],
    };
  });
}
