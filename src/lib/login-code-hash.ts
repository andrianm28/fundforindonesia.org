import { createHmac, randomBytes } from 'node:crypto';

/**
 * The keyed hash a login code is stored under (src/lib/login-code.ts). Kept
 * apart from that module, with no database or alias imports, so the e2e
 * helper that signs operators in (tests/e2e/operator-sign-in.ts) hashes a code
 * exactly the way the server checks it.
 */
const CODE_DOMAIN = 'fund-for-indonesia:login-code:v1';

let ephemeralSecret: string | undefined;

function resolveSecret(secret?: string): string {
  const configured = secret ?? process.env.NEXTAUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('NEXTAUTH_SECRET is not set');
  ephemeralSecret ??= randomBytes(32).toString('hex');
  return ephemeralSecret;
}

export function hashLoginCode(userId: string, code: string, secret?: string): string {
  const key = createHmac('sha256', resolveSecret(secret)).update(CODE_DOMAIN).digest();
  return createHmac('sha256', key).update(`${userId}:${code}`).digest('hex');
}

