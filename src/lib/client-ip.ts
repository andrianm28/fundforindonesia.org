import { createHmac, randomBytes } from 'node:crypto';

/**
 * Who is calling a public endpoint, as far as the rate limit (csr-06b) needs.
 *
 * Deployment assumption (docs: docker-compose.prod.yml binds the app to
 * 127.0.0.1:8093, so a reverse proxy on the host is the only way in; its
 * config is not in this repo and is the owner's to confirm): that proxy is
 * nginx with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`,
 * which APPENDS the address it saw to whatever the client sent. So the front
 * of the header is client-controlled and spoofable, and the entry to trust is
 * the one the proxy added: the last, or the (hops)th from the end when more
 * than one trusted proxy sits in the chain (TRUSTED_PROXY_HOPS, default 1).
 * If the proxy overwrote the header instead, the last entry is still right.
 *
 * Without the header the caller shares one 'unknown' bucket: bounded, never
 * unbounded. This module is server-only; client code must not import it.
 */
export function clientAddress(headers: Headers): string {
  const raw = headers.get('x-forwarded-for');
  if (!raw) return 'unknown';
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) return 'unknown';
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10);
  const fromEnd = Number.isInteger(hops) && hops >= 1 ? hops : 1;
  const chosen = parts[Math.max(0, parts.length - fromEnd)];
  return chosen.slice(0, 64);
}

// Outside production with no secret configured, a per-process random one: the
// buckets still work for a dev server, and no constant is committed.
let ephemeralSecret: string | undefined;

function hashSecret(): string {
  const configured = process.env.RATE_LIMIT_SECRET || process.env.NEXTAUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RATE_LIMIT_SECRET (or NEXTAUTH_SECRET) is not set');
  }
  ephemeralSecret ??= randomBytes(32).toString('hex');
  return ephemeralSecret;
}

/**
 * Keyed hash of a subject (an address). The raw address is never stored: a
 * dump of the bucket table shows 64 hex characters that cannot be reversed
 * without the secret, and the rows are deleted a day after their window.
 */
export function hashSubject(subject: string): string {
  return createHmac('sha256', hashSecret()).update(`rate-limit:${subject}`).digest('hex');
}
