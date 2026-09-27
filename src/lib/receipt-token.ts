import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 24;

/**
 * Names a Receipt's print page (CONTEXT.md, Receipt) to whoever holds the
 * link -- a Guest Donor has no account, so this token is the page's only
 * gate. Random, never derived from the Donation id or anything else guessable.
 */
export function generateReceiptToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}
