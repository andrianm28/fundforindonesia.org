import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Proof that src/proxy.ts, not a client, tagged a request as English.
 * Indonesian paths skip the proxy, so a client can send any header on them;
 * only the proxy can add this one, because it is an HMAC of the locale under
 * the server secret. Without a secret nothing is signed and nothing verifies.
 */
export const LOCALE_SIGNATURE_HEADER = 'x-ffi-locale-sig';

export function signLocale(locale: string): string | null {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`ffi-locale:${locale}`).digest('hex');
}

export function verifyLocaleSignature(locale: string, signature: string | null | undefined): boolean {
  const expected = signLocale(locale);
  if (!expected || !signature) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
