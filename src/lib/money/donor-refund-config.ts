import { Kind } from '@/generated/prisma/client';

/**
 * The anti-abuse limits on a Donor's own Refund request (CONTEXT.md, Refund;
 * PRD 7.2), read from the environment and nowhere else.
 *
 * The numbers are deliberately NOT in this repository: it is public, and a
 * limit that is published is a limit to be probed. So there is no default
 * here. A required value that is unset or not a positive whole number turns
 * the whole feature OFF (readDonorRefundConfig returns null); a Kind whose
 * amount cap is unset or invalid is disallowed on its own. Failing closed is
 * the only direction that keeps the money.
 *
 *   DONOR_REFUND_WINDOW_HOURS         hours after Settlement a request is allowed
 *   DONOR_REFUND_MAX_OPEN_PER_DONOR   requests one Donor may have waiting at once
 *   DONOR_REFUND_MAX_AMOUNT_<KIND>    cap in rupiah per request for that Kind
 *                                     (DONATION, ZAKAT, WAKAF, HIBAH)
 */
export interface DonorRefundConfig {
  windowHours: number;
  maxOpenPerDonor: number;
  /** A Kind absent from here is not allowed to be requested at all. */
  maxAmountByKind: Partial<Record<Kind, number>>;
}

type Env = Record<string, string | undefined>;

/** Digits only: "12abc", "1e3", "-5", " 7" and "0" are all invalid, not coerced. */
function positiveInt(raw: string | undefined): number | null {
  if (raw === undefined || !/^[1-9]\d{0,14}$/.test(raw)) return null;
  return Number(raw);
}

export function readDonorRefundConfig(env: Env = process.env): DonorRefundConfig | null {
  const windowHours = positiveInt(env.DONOR_REFUND_WINDOW_HOURS);
  const maxOpenPerDonor = positiveInt(env.DONOR_REFUND_MAX_OPEN_PER_DONOR);
  if (windowHours === null || maxOpenPerDonor === null) return null;

  const maxAmountByKind: Partial<Record<Kind, number>> = {};
  for (const kind of Object.values(Kind)) {
    const cap = positiveInt(env[`DONOR_REFUND_MAX_AMOUNT_${kind}`]);
    if (cap !== null) maxAmountByKind[kind] = cap;
  }
  return { windowHours, maxOpenPerDonor, maxAmountByKind };
}
