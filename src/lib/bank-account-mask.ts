/**
 * Masks a Bank Account number for the Verifier queue's list view (ticket 16,
 * decision 6): the decide panel shows the full number, decrypted through
 * `readBankAccountNumber` (./contact-fields.ts), because a mistyped digit
 * cannot be checked without it; the list before it may only ever show this
 * mask.
 *
 * Fixed-width and tail-only on purpose: a fixed number of asterisks never
 * leaks the account number's own length, and showing a tail rather than a
 * head never reveals a digit from the middle. A number no longer than the
 * tail is masked in full rather than shown outright -- the point of a mask
 * is that it never degrades into the plaintext it stands in for.
 */
const TAIL_LENGTH = 4;
const MASK = "****";

export function maskBankAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= TAIL_LENGTH) return MASK;
  return MASK + accountNumber.slice(-TAIL_LENGTH);
}
