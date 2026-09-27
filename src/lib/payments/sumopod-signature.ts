/**
 * The svix webhook signature scheme, which Sumopod uses verbatim:
 * base64(HMAC-SHA256(`{svix-id}.{svix-timestamp}.{raw body}`, base64decode(secret))).
 *
 * Kept in its own file, beside the Midtrans scheme in signature.ts, for the
 * same reason that one is: this is the single piece of crypto deciding
 * whether an incoming "you were paid" is real, and it should be readable and
 * testable without a provider class around it.
 *
 * Built on Web Crypto rather than node:crypto so it runs unchanged in an
 * edge runtime, should one ever be needed here again (the proxy itself now
 * runs on Node.js only; see src/proxy.ts).
 */

/** Svix's own tolerance, and the reason the timestamp is inside the signed message. */
export const SUMOPOD_REPLAY_TOLERANCE_SECONDS = 5 * 60;

export interface SumopodSignatureInput {
  /** The `svix-id` header. Also the event's idempotency key. */
  id: string;
  /** The `svix-timestamp` header: whole seconds since the epoch, as a string. */
  timestamp: string;
  /**
   * The request body exactly as it arrived, byte for byte. Re-serialising a
   * parsed object changes whitespace and key order, and the signature is over
   * the bytes, so a round-tripped body never verifies.
   */
  body: string;
}

// Written with index loops rather than spread or Uint8Array.from, matching
// signature.ts: this file is imported by middleware-adjacent code compiled
// without downlevelIteration.
function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64Encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function computeSumopodSignature(
  input: SumopodSignatureInput,
  secret: string,
): Promise<string> {
  // The `whsec_` prefix is a human-readable label, not key material. Svix's
  // own libraries strip it before decoding, and keeping it would key the HMAC
  // with six bytes nobody else uses.
  const keyBytes = base64Decode(secret.replace(/^whsec_/, ''));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.body}`),
  );
  return base64Encode(mac);
}

/**
 * Length-checked, byte-by-byte comparison. String equality short-circuits at
 * the first differing character, which leaks how much of the expected
 * signature a caller has guessed.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isWithinReplayWindow(timestamp: string): boolean {
  // A blank or non-numeric timestamp parses to NaN, and every comparison
  // against NaN is false, so this returns false. That is the intended
  // direction: an unreadable timestamp is refused, never treated as fresh.
  if (!/^-?\d+$/.test(timestamp)) return false;
  const sent = Number(timestamp);
  const drift = Math.abs(Math.floor(Date.now() / 1000) - sent);
  return drift <= SUMOPOD_REPLAY_TOLERANCE_SECONDS;
}

export interface SumopodVerifyInput extends SumopodSignatureInput {
  /**
   * The `svix-signature` header. Space-separated `v{version},{base64}` pairs;
   * more than one appears for about a day after the signing secret is
   * rotated, and both are valid in that window.
   */
  header: string;
}

export async function verifySumopodSignature(
  input: SumopodVerifyInput,
  secret: string,
): Promise<boolean> {
  // Checked before the HMAC so a stale capture costs no crypto, and because
  // a signature that is correct but ancient is exactly the replay this guard
  // exists to refuse.
  if (!isWithinReplayWindow(input.timestamp)) return false;

  const presented = input.header
    .split(' ')
    .map((part) => part.split(','))
    .filter(([version]) => version === 'v1')
    .map(([, signature]) => signature ?? '');

  if (presented.length === 0) return false;

  const expected = await computeSumopodSignature(input, secret);

  // Every candidate is compared, without breaking out on the first match, so
  // the work does not depend on which one matched.
  return presented.reduce(
    (matched, candidate) => constantTimeEqual(expected, candidate) || matched,
    false,
  );
}
