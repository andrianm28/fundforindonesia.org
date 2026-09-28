/**
 * The structured note ticket 13 decided a Payout's proof of transfer has to
 * be: a transaction reference plus a free sentence, the same shape
 * `cleanProofReference` gives a Manual Contribution
 * (src/lib/money/manual-contributions.ts) -- "aturan `cleanProofReference`-
 * style", per the owner's 2026-09-28 answer
 * (.scratch/rilis-1-benda/issues/13-what-counts-as-proof-that-the-money-moved.md).
 *
 * ONE VALIDATOR, TWO CALLERS. `completePayout` (src/lib/money/payouts.ts)
 * imports these same three functions and refuses a Payout completion whose
 * reference or note fails them, under the same subject row lock as every
 * other completePayout check (@/lib/money/errors.ts's PayoutProofInvalidError,
 * mapped to 400). The Admin's own form
 * (src/components/admin/AdminPayoutActionForm.tsx) imports them too, to
 * disable its submit button and show the same message before the request
 * ever leaves the browser. Neither copies the other's rule: a screen that
 * warned about one shape while the server enforced another is exactly what
 * @/lib/payout-balance-rule.ts's own doc comment (`exceedsPayoutBalance`)
 * warns against, and this module is that same arrangement for the proof
 * instead of the amount. `buildProofImage` is the one place the two
 * validated fields become the single string `Payout.proofImage` still
 * stores (no migration; ticket 13's answer only asked for a structured
 * value, not a new column).
 */

export const MAX_PROOF_REFERENCE_LENGTH = 200;
export const MAX_PROOF_NOTE_LENGTH = 500;

/** The reference field's own rule, or null when the value passes it. */
export function validateProofReference(value: string): string | null {
  if (value.trim() === '') {
    return 'Referensi transaksi wajib diisi.';
  }
  if (value.trim().length > MAX_PROOF_REFERENCE_LENGTH) {
    return `Referensi transaksi paling panjang ${MAX_PROOF_REFERENCE_LENGTH} karakter.`;
  }
  return null;
}

/** The note field's own rule, or null when the value passes it. */
export function validateProofNote(value: string): string | null {
  if (value.trim() === '') {
    return 'Catatan wajib diisi.';
  }
  if (value.trim().length > MAX_PROOF_NOTE_LENGTH) {
    return `Catatan paling panjang ${MAX_PROOF_NOTE_LENGTH} karakter.`;
  }
  return null;
}

/**
 * The one string the complete route's `proofImage` field still accepts,
 * built from the two fields the form actually collected. Both are trimmed
 * before joining, so the stored string carries no leading or trailing
 * whitespace from either half.
 */
export function buildProofImage(reference: string, note: string): string {
  return `${reference.trim()} — ${note.trim()}`;
}
