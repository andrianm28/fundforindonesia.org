import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 24;

/**
 * Names an Akad Wakaf's print page (CONTEXT.md, Akad Wakaf) to whoever holds
 * the link -- a Wakif with no account has no session to gate it with
 * instead. Random, never derived from the Donation id or anything else
 * guessable, same as generateReceiptToken.
 */
export function generateAkadWakafToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}
