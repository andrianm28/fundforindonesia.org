import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withRoleCheck } from '@/lib/withRoleCheck';
import { findUnbalancedTransactions } from '@/lib/money/ledger';

/**
 * GET /api/admin/reconcile -- ADMIN-only reconciliation report.
 *
 * Reports. Never corrects. A reconciliation job that silently fixes its own
 * findings destroys the evidence of what went wrong, and in a money system
 * that evidence is the only way to learn what broke -- so nothing in this
 * file writes anything.
 *
 * Four things it surfaces:
 *
 *  - unbalancedTransactions: findUnbalancedTransactions (./ledger.ts). Should
 *    always be empty -- postTransaction refuses to post an unbalanced set of
 *    legs -- so a non-empty result means some write bypassed it entirely.
 *  - negativeBalances: a campaign-scoped account (ESCROW_HOLD or
 *    CAMPAIGN_BALANCE) whose credits-minus-debits has gone below zero.
 *    Should be impossible given the caps in releaseMaturedEscrow
 *    (./escrow.ts) and the balance checks in ./payouts.ts; this is what
 *    would catch it if one of those was ever wrong.
 *  - collectedAmountMismatches: Campaign.collectedAmount disagreeing with
 *    what the ledger says this campaign has ever been credited. Per
 *    ledger.ts's doc comment, the ledger is right when the two disagree --
 *    this reports the gap, it does not touch collectedAmount to close it.
 *    A campaign funded through /api/balance/donate (the wallet flow, which
 *    posts no ledger entries at all) will always show up here -- that is a
 *    real, pre-existing gap between that flow and the money layer, not a
 *    bug in this comparison.
 *  - stuckPayouts: two payout states nothing in this codebase currently
 *    drains. Surfaced, not fixed -- see the comments below for why.
 */
export const GET = withRoleCheck('ADMIN', async (_req: NextRequest) => {
  const report = await prisma.$transaction(async (tx) => {
    const unbalancedTransactions = await findUnbalancedTransactions(tx);

    // One pass over every campaign-scoped ledger entry, bucketed by
    // campaign + account and netted by direction -- the same
    // credits-minus-debits shape as ledger.ts's accountBalance, computed for
    // every campaign at once instead of one at a time.
    const balanceRows = await tx.ledgerEntry.groupBy({
      by: ['campaignId', 'account', 'direction'],
      where: { campaignId: { not: null } },
      _sum: { amount: true },
    });

    const balances = new Map<string, Map<string, number>>();
    for (const row of balanceRows) {
      const campaignId = row.campaignId as string;
      const perCampaign = balances.get(campaignId) ?? new Map<string, number>();
      const signed = row.direction === 'CREDIT' ? (row._sum.amount ?? 0) : -(row._sum.amount ?? 0);
      perCampaign.set(row.account, (perCampaign.get(row.account) ?? 0) + signed);
      balances.set(campaignId, perCampaign);
    }

    // Array.from rather than a direct for-of over the Map: this repo's
    // tsconfig target predates downlevel iteration, same reason
    // findUnbalancedTransactions (./ledger.ts) does the same.
    const negativeBalances: Array<{ campaignId: string; account: string; balance: number }> = [];
    for (const [campaignId, perCampaign] of Array.from(balances.entries())) {
      for (const account of ['ESCROW_HOLD', 'CAMPAIGN_BALANCE'] as const) {
        const balance = perCampaign.get(account) ?? 0;
        if (balance < 0) negativeBalances.push({ campaignId, account, balance });
      }
    }

    // Campaign.collectedAmount is written, in the same transaction as the
    // ledger, as the payment's GROSS amount (see the webhook route). The
    // ledger instead credits ESCROW_HOLD the NET and PROVIDER_FEE the fee
    // (paymentSettledLegs, ./ledger.ts) -- PROVIDER_FEE is a platform-level
    // account and carries no campaignId of its own (CAMPAIGN_SCOPED,
    // ./ledger.ts), so its fee entries are attributed back to a campaign
    // here, for this report only, via the Payment/Donation each entry
    // names. net-ever-credited + fee reconstructs the gross the ledger saw
    // for this campaign; that is what collectedAmount is compared against.
    const escrowCreditRows = await tx.ledgerEntry.groupBy({
      by: ['campaignId'],
      where: { account: 'ESCROW_HOLD', direction: 'CREDIT', campaignId: { not: null } },
      _sum: { amount: true },
    });
    const netEverCreditedByCampaign = new Map<string, number>(
      escrowCreditRows.map((r) => [r.campaignId as string, r._sum.amount ?? 0]),
    );

    const providerFeeEntries = await tx.ledgerEntry.findMany({
      where: { account: 'PROVIDER_FEE', direction: 'CREDIT', paymentId: { not: null } },
      select: { amount: true, paymentId: true },
    });
    const feePaymentIds = Array.from(new Set(providerFeeEntries.map((e) => e.paymentId as string)));
    const feePayments = feePaymentIds.length
      ? await tx.payment.findMany({
          where: { id: { in: feePaymentIds } },
          select: { id: true, donation: { select: { campaignId: true } } },
        })
      : [];
    const campaignIdByPaymentId = new Map(feePayments.map((p) => [p.id, p.donation.campaignId]));
    const feeByCampaign = new Map<string, number>();
    for (const entry of providerFeeEntries) {
      const campaignId = campaignIdByPaymentId.get(entry.paymentId as string);
      if (!campaignId) continue;
      feeByCampaign.set(campaignId, (feeByCampaign.get(campaignId) ?? 0) + entry.amount);
    }

    const campaigns = await tx.campaign.findMany({
      select: { id: true, title: true, collectedAmount: true },
    });

    const collectedAmountMismatches: Array<{
      campaignId: string;
      campaignTitle: string;
      collectedAmount: number;
      ledgerAmount: number;
      difference: number;
    }> = [];
    for (const campaign of campaigns) {
      const ledgerAmount =
        (netEverCreditedByCampaign.get(campaign.id) ?? 0) + (feeByCampaign.get(campaign.id) ?? 0);
      if (ledgerAmount !== campaign.collectedAmount) {
        collectedAmountMismatches.push({
          campaignId: campaign.id,
          campaignTitle: campaign.title,
          collectedAmount: campaign.collectedAmount,
          ledgerAmount,
          difference: campaign.collectedAmount - ledgerAmount,
        });
      }
    }

    // Two payout states nothing in this codebase currently drains -- see the
    // module doc comment above for why fixing either is out of scope here.
    const processingPayouts = await tx.payout.findMany({
      where: { status: 'PROCESSING' },
      select: { id: true, campaignId: true, amount: true, providerRef: true, approvedAt: true },
    });
    const approvedWithoutProviderRef = await tx.payout.findMany({
      where: { status: 'APPROVED', providerRef: null },
      select: { id: true, campaignId: true, amount: true, approvedAt: true },
    });

    return {
      generatedAt: new Date().toISOString(),
      unbalancedTransactions,
      negativeBalances,
      collectedAmountMismatches,
      stuckPayouts: {
        // Instructed to the bank (CAMPAIGN_BALANCE debited, PAYOUT_CLEARING
        // credited, payoutInstructedLegs in ./ledger.ts) but nothing in this
        // codebase ever moves PROCESSING to COMPLETED or drains
        // PAYOUT_CLEARING -- that needs a provider callback nobody has
        // scoped yet. Money instructed out sits here until a human, or a
        // future task, resolves it.
        processing: processingPayouts.map((p) => ({
          payoutId: p.id,
          campaignId: p.campaignId,
          amount: p.amount,
          providerRef: p.providerRef,
          approvedAt: p.approvedAt,
        })),
        // approveAndReleasePayout (./payouts.ts) leaves a payout exactly in
        // this state when its provider call throws after the instructed
        // legs already committed: APPROVED, ledger legs posted, no
        // providerRef. Visible and reconcilable by a human; deliberately not
        // auto-reverted, because an error from the provider does not prove
        // the transfer never reached the bank.
        approvedWithoutProviderRef: approvedWithoutProviderRef.map((p) => ({
          payoutId: p.id,
          campaignId: p.campaignId,
          amount: p.amount,
          approvedAt: p.approvedAt,
        })),
      },
    };
  });

  return NextResponse.json(report);
});
