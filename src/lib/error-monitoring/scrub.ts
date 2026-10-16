/**
 * PII scrubber for error reports. Every event passes through `scrub` before it
 * leaves the process, so the monitoring backend never receives an email
 * address, a bank account number, a token, a credential header or a request
 * body. It works on strings and on any JSON-like value (deep, cycle-safe).
 */

const REDACTED = '[redacted]';
const MAX_DEPTH = 8;

/** Header and field names whose value is never sent, whatever it holds. */
const SECRET_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|cookies|x-jobs-secret|x-api-key|x-signature|x-callback-token|svix-signature|svix-id|svix-timestamp|password|secret|token|access_token|refresh_token|body|data|rawbody|requestbody|payload|formdata)$/i;

/** Path segments that carry a capability token (receipt, akad, reset links). */
const TOKEN_PATH = /\/(receipts?|akad-wakaf|sertifikat|reset-password|password-reset|verify-email|verify|reset)\/[^/?#\s]+/gi;
const TOKEN_QUERY = /([?&](?:token|t|key|sig|signature|code|secret|access_token)=)[^&#\s]*/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC = /\bBasic\s+[A-Za-z0-9+/=]{8,}/g;
/** svix signatures: `v1,<base64>` (possibly several, space separated). */
const SVIX_SIGNATURE = /\bv1[,=][A-Za-z0-9+/=_-]{16,}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** Long opaque strings (hex or base64url of 32+ chars) are treated as tokens. */
const OPAQUE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;
/** 8+ digits, optionally grouped by single spaces or dashes: account numbers. */
const DIGIT_RUN = /\d(?:[ -]?\d){7,}/g;

export function scrubString(input: string): string {
  return input
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(BASIC, `Basic ${REDACTED}`)
    .replace(SVIX_SIGNATURE, REDACTED)
    .replace(TOKEN_PATH, (_m, segment: string) => `/${segment}/${REDACTED}`)
    .replace(TOKEN_QUERY, `$1${REDACTED}`)
    .replace(EMAIL, '[email]')
    .replace(OPAQUE, REDACTED)
    .replace(DIGIT_RUN, '[number]');
}

export function scrub<T>(value: T): T {
  return walk(value, 0, new WeakSet()) as T;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : walk(v, depth + 1, seen);
  }
  return out;
}
