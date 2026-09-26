/**
 * Pure Platform Fee math (CONTEXT.md, Platform Fee; prd-compliance 17):
 * integer rupiah only, rounded DOWN so the remainder falls to the Campaign
 * and never to the platform. No Prisma import here on purpose -- this file
 * is safe to import from a client component (CampaignDetailView shows the
 * rate in force) as well as from the server routes that resolve and freeze
 * the fee. Resolution against Campaign/Category/Kind and the Admin-set
 * threshold lives in ./platform-fee-config.ts, which does touch the
 * database.
 */

/** A rate in basis points: 1 bp = 0.01% of Gross. 250 = 2.5%. Kept an
 * integer so no rate ever needs a float. */
export type PercentBps = number;

export const BPS_DENOMINATOR = 10_000;

/**
 * Integer-safe floor of (amount * percentBps) / BPS_DENOMINATOR, via BigInt
 * so a large Gross times a rate never loses precision the way a float
 * division could once amount * percentBps exceeds 2^53. Mirrors
 * ceilMulDiv in ./ledger.ts, which does the same arithmetic for the
 * Provider Fee's refund share -- rounding the other way, because that one
 * must never let the platform recognise more fee than a Payment actually
 * paid, while this one must never let the platform keep more than
 * percentBps of Gross.
 */
export function floorFeeShare(amount: number, percentBps: PercentBps): number {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`amount must be a non-negative integer rupiah, got ${amount}.`);
  }
  if (!Number.isInteger(percentBps) || percentBps < 0) {
    throw new RangeError(`percentBps must be a non-negative integer, got ${percentBps}.`);
  }
  return Number((BigInt(amount) * BigInt(percentBps)) / BigInt(BPS_DENOMINATOR));
}

/**
 * The Platform Fee for one Donation's Gross amount, given the resolved rate
 * and waiver threshold (prd-compliance 17):
 *
 *  - waived entirely below the Admin-set threshold, so a small gift carries
 *    only the Provider Fee;
 *  - otherwise `percentBps` of Gross, rounded DOWN.
 *
 * Callers pass the basis already resolved (resolvePlatformFeeBasis, in
 * ./platform-fee-config.ts) -- this function does no lookup and no I/O, so
 * it can be unit-tested against worked examples with no database at all.
 */
export function computePlatformFee(params: {
  grossAmount: number;
  percentBps: PercentBps;
  thresholdAmount: number;
}): number {
  const { grossAmount, percentBps, thresholdAmount } = params;
  if (grossAmount < thresholdAmount) return 0;
  return floorFeeShare(grossAmount, percentBps);
}

/** How the rate in force reads on the Campaign page: "2,5%", "0%" -- Indonesian
 * decimal comma, no trailing zero for a whole percent. */
export function formatFeePercent(percentBps: PercentBps): string {
  const percent = percentBps / 100;
  return `${percent.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
}
