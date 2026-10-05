import type { Prisma } from '@/generated/prisma/client';
import { isBetaSandbox } from '@/lib/deploy-environment';

/**
 * "Payment yang dihitung": which Payments count towards the figures this
 * platform publishes and reconciles (ticket rilis-1-benda/92).
 *
 * Every Payment is stamped `sandbox` when it is created (chargeDonation and the
 * Trip Fee registration route), from the BETA_SANDBOX marker in force at that
 * moment. Whether it COUNTS is a different question, asked at read time:
 *
 *   - In the beta (marker on) everything counts. The beta's whole purpose is
 *     to rehearse the platform, so its public totals and its reconciliation
 *     report show the rehearsal money, which is what a tester needs to see.
 *   - Live (marker off) a sandbox-stamped Payment does not count. Beta data
 *     stays in the database as evidence but never reaches a public total or the
 *     live reconciliation report.
 *
 * This is the ONE definition. A caller that needs "the Payments that count"
 * spreads `countedPaymentWhere()` into its Payment query, or filters rows with
 * `isCountedPayment`; nobody writes `sandbox: false` themselves, because the
 * beta branch is exactly the part a second copy would forget.
 *
 * Deliberately not applied to the Ledger paths that read money by account
 * (balances, Payout, Refund): see the Comments of rilis-1-benda/92.
 */

/** A Prisma `where` fragment for Payment rows that count right now. */
export function countedPaymentWhere(): Prisma.PaymentWhereInput {
  return isBetaSandbox() ? {} : { sandbox: false };
}

/** The same rule for a row already in hand. */
export function isCountedPayment(payment: { sandbox: boolean }): boolean {
  return isBetaSandbox() || !payment.sandbox;
}

/**
 * The stamp for a Payment being created now. One name for "this Payment's
 * mode", so the two creation points cannot disagree about how it is read.
 */
export function currentPaymentSandboxStamp(): boolean {
  return isBetaSandbox();
}

/**
 * The part of each Campaign's stored `collectedAmount` that came from Payments
 * which do not count right now, keyed by Campaign id.
 *
 * `Campaign.collectedAmount` is a lifetime counter incremented at Settlement
 * (the webhook route), so a go-live that removes the beta marker cannot
 * un-increment it. The public progress figure is therefore the counter minus
 * this: the Gross of the PAID sandbox Payments, which only exist to subtract
 * when the marker is off. In the beta this answers an empty map without
 * querying.
 */
export async function uncountedGrossByCampaign(
  db: Pick<Prisma.TransactionClient, 'payment'>,
  campaignIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (isBetaSandbox() || campaignIds.length === 0) return out;

  const rows = await db.payment.findMany({
    where: {
      status: 'PAID',
      sandbox: true,
      donation: { campaignId: { in: campaignIds } },
    },
    select: { amount: true, donation: { select: { campaignId: true } } },
  });
  for (const row of rows) {
    const campaignId = row.donation?.campaignId;
    if (!campaignId) continue;
    out.set(campaignId, (out.get(campaignId) ?? 0) + row.amount);
  }
  return out;
}

/**
 * The same rows with `collectedAmount` as the public may see it: the stored
 * counter less what sandbox Payments contributed to it while the marker is off.
 * Every public read of a Campaign's progress goes through here.
 */
export async function withCountedCollectedAmount<T extends { id: string; collectedAmount: number }>(
  db: Pick<Prisma.TransactionClient, 'payment'>,
  campaigns: T[],
): Promise<T[]> {
  const uncounted = await uncountedGrossByCampaign(
    db,
    campaigns.map((c) => c.id),
  );
  if (uncounted.size === 0) return campaigns;
  return campaigns.map((c) => ({
    ...c,
    collectedAmount: Math.max(0, c.collectedAmount - (uncounted.get(c.id) ?? 0)),
  }));
}
