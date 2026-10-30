import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The signing scheme behind the payment result links (tickets 98 and 99): a
 * stateless token that opens one subject's result page without a session.
 *
 *   token = base64url(payload) '.' base64url(HMAC(key, payload))
 *   payload = `${expiresAtEpochSeconds}:${subjectId}`
 *
 * Each result page has its OWN `domain` string, from which the signing key is
 * derived (HMAC(secret, domain)), so a token minted for a Donation can never
 * open a Registration page or the other way round, even for the same id. The
 * secret itself is never the key: NEXTAUTH_SECRET also keys next-auth, the
 * rate limiter and the password reset link.
 *
 * Verification never throws on bad input; anything malformed, tampered or
 * expired is `null`. Server-only: never import this from client code.
 */

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

export interface ResultTokenCodec {
  sign(subjectId: string, nowMs: number, secret?: string): string;
  verify(token: unknown, nowMs: number, secret?: string): string | null;
}

export function createResultTokenCodec(domain: string, ttlSeconds: number): ResultTokenCodec {
  function signature(payload: string, secret?: string): Buffer {
    const key = createHmac('sha256', resolveSecret(secret)).update(domain).digest();
    return createHmac('sha256', key).update(payload).digest();
  }

  return {
    sign(subjectId, nowMs, secret) {
      const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
      const payload = Buffer.from(`${expiresAt}:${subjectId}`, 'utf8').toString('base64url');
      return `${payload}.${signature(payload, secret).toString('base64url')}`;
    },

    verify(token, nowMs, secret) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [payload, given64] = parts;
      if (!BASE64URL.test(payload) || !BASE64URL.test(given64)) return null;

      const given = Buffer.from(given64, 'base64url');
      // Node ignores the spare bits of the last base64url character, so several
      // spellings decode to the same bytes; only the one we would write is accepted.
      if (given.toString('base64url') !== given64) return null;
      const expected = signature(payload, secret);
      // timingSafeEqual throws on unequal lengths, so a wrong length is refused first.
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

      // Only a payload this server signed is parsed at all.
      const decoded = Buffer.from(payload, 'base64url').toString('utf8');
      const colon = decoded.indexOf(':');
      if (colon < 1) return null;
      const expiry = decoded.slice(0, colon);
      const subjectId = decoded.slice(colon + 1);
      if (!/^\d{1,12}$/.test(expiry) || subjectId === '') return null;
      if (Number(expiry) * 1000 <= nowMs) return null;
      return subjectId;
    },
  };
}
