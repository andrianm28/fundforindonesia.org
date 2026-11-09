import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) over HMAC-SHA1, 30-second steps, built on node:crypto so the
 * second factor needs no dependency (ticket pks-pemenuhan/03). SHA-1 is what
 * every authenticator app assumes; HMAC-SHA1 is not weakened by SHA-1's
 * collision problems. Pure functions: storage, rate limits and replay
 * protection live in ./mfa.ts.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps either side of the current one that still verify (clock drift). */
export const TOTP_WINDOW = 1;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Case-insensitive; spaces, dashes and `=` padding are ignored. Throws on any other character. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error("Not a base32 string");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 random bits, base32: what an authenticator app is given. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(key: Buffer, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code for the step containing `nowMs`. `key` is the raw secret. */
export function totpAt(key: Buffer, nowMs: number, options: { digits?: number } = {}): string {
  return hotp(key, totpStep(nowMs), options.digits ?? TOTP_DIGITS);
}

/**
 * The step whose code equals `code`, within TOTP_WINDOW of `nowMs`, or null.
 * The caller records the step to refuse a second use of it. Every candidate is
 * compared, in constant time, so the answer does not leak which step matched.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number): number | null {
  const candidate = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(candidate)) return null;
  const key = base32Decode(secretBase32);
  const current = totpStep(nowMs);
  let matched: number | null = null;
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    const expected = Buffer.from(hotp(key, step, TOTP_DIGITS));
    if (timingSafeEqual(expected, Buffer.from(candidate)) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(params: { secret: string; account: string; issuer: string }): string {
  const issuer = encodeURIComponent(params.issuer);
  return (
    `otpauth://totp/${issuer}:${encodeURIComponent(params.account)}` +
    `?secret=${params.secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`
  );
}
