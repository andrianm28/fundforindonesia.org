import { createHmac, randomBytes } from 'node:crypto';

const SESSION_DOMAIN = 'fund-for-indonesia:session-password:v1';

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
