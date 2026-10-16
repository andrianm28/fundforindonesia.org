import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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
 *   working after {@link PAYMENT_RESULT_TTL_SECONDS}.
 * - **Verification never throws on bad input.** Anything malformed, tampered or
 *   expired is `null`, and the page answers 404 for all of them alike.
 *
 * Server-only: never import this from client code.
 */

export const PAYMENT_RESULT_TTL_SECONDS = 30 * 24 * 60 * 60;

const DOMAIN = 'fund-for-indonesia:payment-result:v1';
/** Longer than any token we sign (~90 characters); bounds the work a junk input costs. */
const MAX_TOKEN_LENGTH = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

// Outside production with no secret configured, a per-process random one, as
// password-reset.ts does: a dev server works, and no constant is committed.
let ephemeralSecret: string | undefined;

function resolveSecret(secret?: string): string {
  const configured = secret ?? process.env.NEXTAUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('NEXTAUTH_SECRET is not set');
  ephemeralSecret ??= randomBytes(32).toString('hex');
  return ephemeralSecret;
}

function sign(payload: string, secret?: string): Buffer {
  const key = createHmac('sha256', resolveSecret(secret)).update(DOMAIN).digest();
  return createHmac('sha256', key).update(payload).digest();
}

/** A token for `donationId` that expires {@link PAYMENT_RESULT_TTL_SECONDS} after `nowMs`. */
export function signPaymentResultToken(donationId: string, nowMs: number, secret?: string): string {
  const expiresAt = Math.floor(nowMs / 1000) + PAYMENT_RESULT_TTL_SECONDS;
  const payload = Buffer.from(`${expiresAt}:${donationId}`, 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

/** The Donation id `token` was signed for, if it is genuine and unexpired at `nowMs`; otherwise null. */
export function verifyPaymentResultToken(token: unknown, nowMs: number, secret?: string): string | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!BASE64URL.test(payload) || !BASE64URL.test(signature)) return null;

  const given = Buffer.from(signature, 'base64url');
  const expected = sign(payload, secret);
  // timingSafeEqual throws on unequal lengths, so a wrong length is refused first.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  // Only a payload this server signed is parsed at all.
  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 1) return null;
  const expiry = decoded.slice(0, colon);
  const donationId = decoded.slice(colon + 1);
  if (!/^\d{1,12}$/.test(expiry) || donationId === '') return null;
  if (Number(expiry) * 1000 <= nowMs) return null;
  return donationId;
}

/** The result page's path for `token`; `cancelled` marks the provider's cancel return. */
export function paymentResultPath(token: string, options: { cancelled?: boolean } = {}): string {
  return `/donasi/hasil/${token}${options.cancelled ? '?batal=1' : ''}`;
}
