import { createResultTokenCodec } from './result-token-codec';

/**
 * The token that opens a Donation's payment result page (ticket 98) without a
 * session: where the provider sends the Donor back after paying or backing
 * out. A Guest Donor has no account, so the link itself is the proof.
 *
 * Stateless, like the password reset link: nothing is stored, so there is no
 * column and no migration.
 *
 *   token = base64url(payload) '.' base64url(HMAC(key, payload))
 *   payload = `${expiresAtEpochSeconds}:${donationId}`
 *
 * - **The key is derived, never the secret itself.** NEXTAUTH_SECRET also keys
 *   next-auth, the rate limiter and the password reset link, so the signing key
 *   is HMAC(secret, 'fund-for-indonesia:payment-result:v1').
 * - **Bound to the Donation, not the Payment.** A retry creates a new Payment on
 *   the same Donation, and a link minted for the first attempt must still show
 *   how the Donation ended.
 * - **It expires.** The page shows status only, and the Receipt email carries
 *   the lasting proof, so a link forwarded or left in browser history stops
 *   working after {@link PAYMENT_RESULT_TTL_SECONDS}. It cannot be revoked one
 *   by one: the only early way out is rotating NEXTAUTH_SECRET, which also ends
 *   every session and reset link. That is why the page shows so little.
 * - **Verification never throws on bad input.** Anything malformed, tampered or
 *   expired is `null`, and the page answers 404 for all of them alike.
 *
 * Server-only: never import this from client code.
 */

export const PAYMENT_RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;

const codec = createResultTokenCodec('fund-for-indonesia:payment-result:v1', PAYMENT_RESULT_TTL_SECONDS);

/** A token for `donationId` that expires {@link PAYMENT_RESULT_TTL_SECONDS} after `nowMs`. */
export function signPaymentResultToken(donationId: string, nowMs: number, secret?: string): string {
  return codec.sign(donationId, nowMs, secret);
}

/** The Donation id `token` was signed for, if it is genuine and unexpired at `nowMs`; otherwise null. */
export function verifyPaymentResultToken(token: unknown, nowMs: number, secret?: string): string | null {
  return codec.verify(token, nowMs, secret);
}

/** The result page's path for `token`; `cancelled` marks the provider's cancel return. */
export function paymentResultPath(token: string, options: { cancelled?: boolean } = {}): string {
  return `/donasi/hasil/${token}${options.cancelled ? '?batal=1' : ''}`;
}
