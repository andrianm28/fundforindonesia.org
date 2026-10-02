import type { PrismaClient } from '@/generated/prisma/client';
import { programBooks } from '@/lib/money/manual-contributions';

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
 *   2. returnedToDonors           handed back, at Gross, PLUS the Frozen
 *                                 Balance of Refunds committed to a Donor
 *                                 but not yet paid out
 *   3. heldInEscrowHold           still inside the waiting period that gives a
 *                                 Refund room to happen (CONTEXT.md)
 *   4. availableInCampaignBalance withdrawable now
 *   5. platformFeeRetained        Platform Fee the platform kept
 *   6. providerFeeKept            Provider Fee the provider kept
 *
 * A refund counts as returned the moment it is created, not when it is
 * approved. refundRequestedLegs moves the money out of the Campaign's pools
 * and into the Frozen Balance in the same transaction, so from that instant it
 * is the Donor's and never the Campaign's again; approval and payment are
 * handovers between two accounts of the same line. So `returnedToDonors` is
 * "money that is, or is about to be, the Donor's" -- which is why its label
 * says so, and why the frozen part is not also counted as Escrow Hold: one
 * rupiah, one line.
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
 * `beneficiaries` is not money and joins no rupiah total: it is the sum of
 * `UsageReport.beneficiaryCount` over the Usage Reports of the same
 * (non-demo, location-filtered) Campaigns' Payouts (ticket 42). A report an
 * Admin marked "dipertanyakan" still counts; it is shown publicly with its
 * reason, and hiding its figure here would be a rule nobody asked for.
 *
 * **CSR is a separate block, not a seventh line** (ticket csr-08; owner
 * decision). `csr` carries two figures that are never added together:
 *
 * - `inTheBooks`: the Program balance the ledger holds across the Programs in
 *   scope, i.e. Manual Contributions credited to a Program net of reversals.
 *   It joins neither `collected` nor the six lines (those are Campaign money),
 *   but it has a reconciliation of its own: every Program balance entry must
 *   carry the Manual Contribution that put it there, or the page refuses to
 *   publish (CsrDoesNotReconcileError, same failure as the six lines).
 * - `outsideTheBooks`: the sum of the plain figures an Admin reported for CSR
 *   money that never crossed the platform's account. No ledger entry stands
 *   behind it by design, so nothing can reconcile it, and it is never added
 *   into any total that claims to. Only the aggregate is public: neither a
 *   per-Program figure nor the free-text `reportedNote`.
 *
 * `manualContributions` reads zero when no Admin has recorded one, or only
 * ones that have since been reversed. `notes` carries the caveat out to the
 * page so a visitor is told why a number is zero.
 */

export const IMPACT_LINES = [
  {
    key: 'disbursedToFundraisers',
    label: 'Tersalurkan ke Fundraiser lewat Payout',
  },
  {
    key: 'returnedToDonors',
    // This page has no auth, so the label is read by a Donor looking at their
    // OWN money, and it is the one line whose figure is not a place money has
    // ended up but money still in transit. Three rules, learned the hard way:
    //
    //   1. The first words must not be a completed-tense verb. "Dikembalikan
    //      ke Donor" as the opening three words is a claim about the Donor's
    //      bank account, and it is false for every Refund that has not been
    //      transferred. "Refund" is the noun and stops there: it names the
    //      kind and asserts no stage at all.
    //   2. No dev jargon. "dikomit" was accurate (the money IS committed) and
    //      meaningless to every reader of a public page; "Refund" says the
    //      same thing to a Donor.
    //   3. The pending part goes LAST, next to the number, because that is
    //      where the eye lands -- not hidden after a comma behind the big
    //      figure and the word "Dikembalikan".
    //
    // Note there is no "belum semuanya ditransfer" tail in the label either:
    // "Refund" is the whole of it. A stage word is deliberately left out of a
    // cell that cannot hold a sentence, and the disclosure is carried by the
    // paragraph under the table and the `notes` entry below -- the two places a
    // Donor actually reads it, next to the figure rather than standing in for
    // it. That tail is also deliberately vague about HOW MANY are outstanding:
    // today nothing has been transferred at all (refundPaidLegs has no
    // production caller, ticket 32), and the moment it gets one the split
    // changes, so a number there would be either wrong today or stale
    // tomorrow.
    label: 'Refund',
  },
  {
    key: 'heldInEscrowHold',
    // Only money still inside the Escrow Hold's waiting period: a Refund's
    // freeze sits on the returned line, because it is the Donor's money, not
    // money the Campaign is still holding (CONTEXT.md, Frozen Balance: "tetap
    // menjadi hak Donor").
    label: 'Ditahan di Escrow Hold, masih dalam masa tunggu',
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
  /** Disbursed but not yet marked COMPLETED (completePayout, ./payouts.ts). */
  disbursedNotYetCompleted: number;
  /**
   * Money that arrived outside the gateway and is counted in `collected`,
   * marked apart so it is never read as a Donation. Zero until an Admin
   * records one; excludes anything already reversed, and excludes
   * Program-targeted money (a Program is not a Campaign; see `csr`).
   */
  manualContributions: number;
  /**
   * CSR money, kept apart from `collected` and the six lines. The two figures
   * are never summed: one is backed by the ledger, the other is only reported.
   */
  csr: {
    /** Program balance across the Programs in scope; ledger-backed and reconciled. */
    inTheBooks: number;
    /** Reported by an Admin for money that never crossed the platform's account; no ledger entry behind it. */
    outsideTheBooks: number;
    programCount: number;
  };
  /** Sum of beneficiaryCount over the Usage Reports in scope; zero while there are none. */
  beneficiaries: number;
  /** The location filter as asked for, or null for the whole platform. */
  location: string | null;
  notes: string[];
}

export class ImpactDoesNotReconcileError extends Error {
  constructor(
    readonly collected: number,
    readonly linesTotal: number,
    message?: string,
  ) {
    super(
      message ??
        `The six Impact lines total ${linesTotal} but the ledger says ${collected} was collected. ` +
          'Refusing to publish a breakdown that does not add up.',
    );
    this.name = 'ImpactDoesNotReconcileError';
  }
}

/**
 * A Program balance that cannot be vouched for: it holds money no Manual
 * Contribution put there (`booked !== explained`), or it is negative (a
 * Program cannot owe money; nothing debits it but a reversal). Not a subclass
 * of ImpactDoesNotReconcileError, whose fields mean "six lines vs collected":
 * the figures here are the booked balance and what contributions explain, so
 * callers that refuse it (the /impact route and page) catch it by name.
 */
export class CsrDoesNotReconcileError extends Error {
  constructor(
    readonly booked: number,
    readonly explained: number,
  ) {
    super(
      `Program balance holds ${booked} but Manual Contributions explain ${explained}` +
        (booked < 0 ? ' and the balance is negative' : '') +
        '. Refusing to publish a CSR figure that does not add up.',
    );
    this.name = 'CsrDoesNotReconcileError';
  }
}

/**
 * The one CSR reconciliation rule, shared by /impact and the Program page so
 * the two cannot disagree: the booked Program balance must equal what Manual
 * Contributions explain, and must not be negative.
 */
export function assertCsrReconciles(booked: number, explained: number): void {
  if (booked !== explained || booked < 0) throw new CsrDoesNotReconcileError(booked, explained);
}

/**
 * A Payout that has been instructed out of the Campaign Balance
 * (payoutInstructedLegs, ./ledger.ts) but not yet marked COMPLETED with proof
 * of transfer (completePayout, ./payouts.ts; ticket 27). Its money has already
 * left, so it belongs in the disbursed line; this is only here so the page can
 * say how much of that figure is still unconfirmed.
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

    // One Usage Report per Payout (UsageReport.payoutId is unique), so summing
    // over the in-scope Payouts cannot count a report twice. Scoped through
    // payoutIds so it follows the same demo and location filter as every other
    // line on the page.
    const usageReports = await tx.usageReport.aggregate({
      where: { payoutId: { in: payoutIds } },
      _sum: { beneficiaryCount: true },
      _count: { _all: true },
    });
    const beneficiaries = usageReports._sum.beneficiaryCount ?? 0;
    const hasUsageReport = usageReports._count._all > 0;

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
    // figure: a Program's entries carry no campaignId at all. FFI-14's CSR
    // line is the separate `csr` block below, never part of `collected`.
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

    // CSR (ticket csr-08). Programs are filtered by the same location the
    // Campaigns are; they have no demo flag, and Campaign.isDemo is not theirs.
    const programs = await tx.program.findMany({
      where: location ? { location: { contains: location, mode: 'insensitive' as const } } : {},
      select: { id: true, reportedAmount: true },
    });
    const programIds = programs.map((p) => p.id);
    // Read by the Manual Contribution module, the one place allowed to name a
    // Program's balance (manual-contribution-isolation.test.ts).
    const { booked: programBooked, explained: programExplained } = await programBooks(tx, programIds);
    assertCsrReconciles(programBooked, programExplained);

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

    // Money a Refund has taken out of the Campaign's pools and set aside for a
    // Donor: refundRequestedLegs credits it at REQUESTED and refundApprovedLegs
    // debits it at APPROVED, so this balance is exactly the Gross of every Refund
    // the platform owes a Donor but has not yet recognised as returned.
    //
    // It is the DONOR's money from the moment the Refund is created, so it is
    // part of the returned line and not of the Escrow Hold one -- but only ONE
    // of the two, or the same rupiah is counted twice and the six lines stop
    // reconciling. The two lines below are one move, not two figures: whatever
    // leaves `heldInEscrowHold` arrives in `returnedToDonors`, so the total
    // across all six is unchanged and the conservation law above still holds by
    // construction rather than by luck.
    const frozenForDonors = balance(campaignPools, 'FROZEN_BALANCE');

    const amounts: Record<ImpactLineKey, number> = {
      disbursedToFundraisers: sum(byPayout, 'PAYOUT_CLEARING:CREDIT'),
      // A Refund is money that really went back, so it is shown at Gross --
      // including the part that is committed to a Donor but not yet paid out,
      // which is the Donor's money all the same (see `frozenForDonors` above)
      // -- except for the part no Campaign money covered, which is the
      // platform's loss rather than a return of collected funds (reported
      // below).
      returnedToDonors: returnedGross + frozenForDonors - uncoveredRefunds,
      heldInEscrowHold: balance(campaignPools, 'ESCROW_HOLD'),
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
      // above; it is reported in `csr` instead.
      manualContributions,
      csr: {
        inTheBooks: programBooked,
        outsideTheBooks: programs.reduce((total, p) => total + p.reportedAmount, 0),
        programCount: programs.length,
      },
      beneficiaries,
      location,
      notes: [
        hasUsageReport
          ? 'Penerima manfaat dihitung dari Usage Report yang sudah dikirim Fundraiser; Usage Report yang ditandai dipertanyakan tetap dihitung.'
          : 'Penerima manfaat dihitung dari Usage Report; belum ada satu pun Usage Report, jadi angkanya nol.',
        'Manual Contribution adalah dana yang masuk di luar payment gateway, dicatat Admin dengan bukti dan disetujui Admin kedua; masuk ke terkumpul tanpa biaya provider maupun platform, dan yang sudah dibalikkan tidak dihitung.',
        'Platform Fee dan Provider Fee adalah uang platform dan penyedia, bukan bagian dari dana Campaign.',
        // The disclosure the returned line cannot make for itself. The label has
        // to stay short, and the table gives a visitor no place to put a
        // sentence -- so this is the paragraph a Donor actually reads. Same
        // shape as the Manual Contribution note above: what the figure
        // INCLUDES, and what is deliberately not counted.
        //
        // Phrased state-agnostically on purpose. "Sebagian sudah ditransfer"
        // would be false today -- refundPaidLegs has no production caller, so
        // none of it has left -- and stale the moment ticket 32 wires it up.
        // What is true in every state of a Refund's life is what the figure
        // COVERS, which is what this says.
        'Angka pengembalian ke Donor mencakup dua hal: uang yang sudah ditransfer ke rekening Donor, dan uang yang sudah disiapkan untuk dikembalikan tetapi belum ditransfer. Yang kedua belum sampai ke Donor dan tetap miliknya; platform tidak menahannya sebagai dana Campaign.',
      ],
    };
  });
}
