import { createResultTokenCodec } from '@/lib/money/result-token-codec';

/**
 * The signed link in every recurring-donation bill email that stops that
 * recurring donation without a login (PKS pasal 4.7). Stateless, the same
 * scheme as the payment result links: nothing is stored.
 *
 * - Bound to the recurring donation id, signed under a key derived for this
 *   purpose only (domain below), so a payment result token can never stop
 *   anything. NEXTAUTH_SECRET is reused, never a new one.
 * - Constant-time compare (the codec uses timingSafeEqual).
 * - It only ever STOPS: the page behind it can do nothing else, so a leaked
 *   link costs the Donor a stop, not money.
 * - 90 days, longer than the longest gap between two emails of a monthly
 *   recurring donation; every bill carries a fresh link. A yearly one gets a
 *   new link each year, and the Donor can always stop from /akun.
 *
 * Server-only.
 */
export const STOP_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

const codec = createResultTokenCodec('fund-for-indonesia:recurring-donation-stop:v1', STOP_TOKEN_TTL_SECONDS);

export function signRecurringStopToken(recurringId: string, nowMs: number, secret?: string): string {
  return codec.sign(recurringId, nowMs, secret);
}

/** The recurring donation id `token` was signed for, if genuine and unexpired; otherwise null. */
export function verifyRecurringStopToken(token: unknown, nowMs: number, secret?: string): string | null {
  return codec.verify(token, nowMs, secret);
}

export function recurringStopPath(token: string): string {
  return `/donasi-rutin/berhenti/${token}`;
}
