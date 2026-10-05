import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';

/**
 * Forgot password (rilis-1 93): a signed link mailed to the account's address.
 *
 * The token is **stateless**: nothing is stored, so there is no table and no
 * migration, and the token carries its own proof.
 *
 *   token = base64url(payload) '.' base64url(HMAC(key, payload '|' fingerprint))
 *   payload = `${expiresAtEpochSeconds}:${userId}`
 *
 * - **The key is derived, never the secret itself.** NEXTAUTH_SECRET also keys
 *   next-auth and the rate limiter, so the signing key is
 *   HMAC(secret, 'fund-for-indonesia:password-reset:v1').
 * - **The fingerprint is what makes it single use.** It is a SHA-256 over the
 *   account's CURRENT password hash and email lookup HMAC, recomputed from the
 *   database at verification. A successful reset changes the hash, so every
 *   outstanding token for that account stops verifying; a changed address does
 *   the same, so a link mailed to the old address cannot be used after the
 *   account moved. The fingerprint is not in the token and a token does not
 *   contain the hash.
 * - **Verification never throws on bad input.** A malformed, tampered, expired
 *   or stale token is `null`/`false`, and the route says the same thing for all.
 *
 * Server-only: never import this from client code.
 */

export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

const RESET_DOMAIN = 'fund-for-indonesia:password-reset:v1';
const SESSION_DOMAIN = 'fund-for-indonesia:session-password:v1';
/** Longer than any token we sign (~150 characters); bounds the work a junk input costs. */
const MAX_TOKEN_LENGTH = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** What a token is bound to: the account, and the two columns whose change must kill it. */
export type ResetSubject = { id: string; password: string | null; emailHmac: string };

// Outside production with no secret configured, a per-process random one, as
// the rate limiter does: a dev server works, and no constant is committed.
let ephemeralSecret: string | undefined;

function resolveSecret(secret?: string): string {
  const configured = secret ?? process.env.NEXTAUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('NEXTAUTH_SECRET is not set');
  ephemeralSecret ??= randomBytes(32).toString('hex');
  return ephemeralSecret;
}

function deriveKey(domain: string, secret?: string): Buffer {
  return createHmac('sha256', resolveSecret(secret)).update(domain).digest();
}

/** JSON keeps a missing password (null) distinct from any string, including "null". */
function fingerprint(subject: Pick<ResetSubject, 'password' | 'emailHmac'>): string {
  return createHash('sha256')
    .update(JSON.stringify([subject.password ?? null, subject.emailHmac]))
    .digest('hex');
}

function sign(payload: string, subject: ResetSubject, secret?: string): Buffer {
  return createHmac('sha256', deriveKey(RESET_DOMAIN, secret)).update(`${payload}|${fingerprint(subject)}`).digest();
}

/** A token for `subject` that expires {@link PASSWORD_RESET_TTL_SECONDS} after `nowMs`. */
export function signPasswordResetToken(subject: ResetSubject, nowMs: number, secret?: string): string {
  const expiresAt = Math.floor(nowMs / 1000) + PASSWORD_RESET_TTL_SECONDS;
  const payload = Buffer.from(`${expiresAt}:${subject.id}`, 'utf8').toString('base64url');
  return `${payload}.${sign(payload, subject, secret).toString('base64url')}`;
}

export type ParsedResetToken = { userId: string; expiresAt: number; payload: string; signature: Buffer };

/** Splits a token into its parts without trusting any of them; null for anything malformed. */
export function readPasswordResetToken(token: unknown): ParsedResetToken | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!BASE64URL.test(payload) || !BASE64URL.test(signature)) return null;

  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 1) return null;
  const expiry = decoded.slice(0, colon);
  const userId = decoded.slice(colon + 1);
  if (!/^\d{1,12}$/.test(expiry) || userId === '') return null;

  return { userId, expiresAt: Number(expiry), payload, signature: Buffer.from(signature, 'base64url') };
}

/** Whether `token` is unexpired at `nowMs` and was signed for exactly this state of `subject`. */
export function checkPasswordResetToken(token: unknown, subject: ResetSubject, nowMs: number, secret?: string): boolean {
  const parsed = readPasswordResetToken(token);
  if (!parsed || parsed.userId !== subject.id) return false;
  if (parsed.expiresAt * 1000 <= nowMs) return false;

  const expected = sign(parsed.payload, subject, secret);
  // timingSafeEqual throws on unequal lengths, so a wrong length is refused first.
  return parsed.signature.length === expected.length && timingSafeEqual(parsed.signature, expected);
}

export type VerifiedResetAccount = ResetSubject & { emailVerifiedAt: Date | null };

/**
 * The account a token is valid for right now, or null. Reads the account to
 * recompute the fingerprint, so a token spent or outdated by a password or
 * address change is refused here. Expiry and shape are checked before the read.
 */
export async function verifyPasswordResetToken(token: unknown, now: Date = new Date()): Promise<VerifiedResetAccount | null> {
  const parsed = readPasswordResetToken(token);
  if (!parsed || parsed.expiresAt * 1000 <= now.getTime()) return null;

  const account = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { id: true, password: true, emailHmac: true, emailVerifiedAt: true },
  });
  if (!account) return null;
  return checkPasswordResetToken(token, account, now.getTime()) ? account : null;
}

/**
 * The short claim a session token carries about the password it was signed in
 * with (src/lib/auth.ts). When the stored hash changes, the claim no longer
 * matches and the session stops being valid. A keyed hash, so the JWT never
 * holds anything derived from the hash that could be tested offline without
 * the server's secret; `null` (a Google account) has its own value.
 */
export function sessionPasswordClaim(password: string | null, secret?: string): string {
  return createHmac('sha256', deriveKey(SESSION_DOMAIN, secret))
    .update(JSON.stringify([password ?? null]))
    .digest('hex')
    .slice(0, 16);
}
