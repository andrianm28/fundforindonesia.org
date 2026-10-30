import { createResultTokenCodec } from './result-token-codec';

/**
 * The token that opens a Registration's payment result page (ticket 99), where
 * the provider sends a Volunteer back after paying the Trip Fee or backing out.
 * Same stateless scheme as the Donation link (payment-result-token.ts) with its
 * own HMAC domain, so the two kinds of link are not interchangeable. No column,
 * no migration. Bound to the Registration, which owns at most one Payment.
 *
 * Server-only: never import this from client code.
 */

export const REGISTRATION_RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;

const codec = createResultTokenCodec('fund-for-indonesia:registration-result:v1', REGISTRATION_RESULT_TTL_SECONDS);

/** A token for `registrationId` that expires {@link REGISTRATION_RESULT_TTL_SECONDS} after `nowMs`. */
export function signRegistrationResultToken(registrationId: string, nowMs: number, secret?: string): string {
  return codec.sign(registrationId, nowMs, secret);
}

/** The Registration id `token` was signed for, if genuine and unexpired at `nowMs`; otherwise null. */
export function verifyRegistrationResultToken(token: unknown, nowMs: number, secret?: string): string | null {
  return codec.verify(token, nowMs, secret);
}

/** The result page's path for `token`; `cancelled` marks the provider's cancel return. */
export function registrationResultPath(token: string, options: { cancelled?: boolean } = {}): string {
  return `/volunteer-trip/hasil/${token}${options.cancelled ? '?batal=1' : ''}`;
}
