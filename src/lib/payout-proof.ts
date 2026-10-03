/**
 * The structured note ticket 13 decided a Payout's proof of transfer has to
 * be: a transaction reference plus a free sentence, the same shape
 * `cleanProofReference` gives a Manual Contribution
 * (src/lib/money/manual-contributions.ts) -- "aturan `cleanProofReference`-
 * style", per the owner's 2026-09-28 answer
 * (.scratch/rilis-1-benda/issues/13-what-counts-as-proof-that-the-money-moved.md).
 *
 * ONE VALIDATOR, NOW THREE CALLERS (ticket 31 added the third).
 * `completePayout` (src/lib/money/payouts.ts) and `completeRefund`
 * (src/lib/money/refunds.ts) both import these same three functions and
 * refuse a completion whose reference or note fails them, under the same
 * subject row lock as every other check each makes
 * (@/lib/money/errors.ts's PayoutProofInvalidError / RefundProofInvalidError,
 * both mapped to 400 -- two classes, because the two still answer for
 * different rows, but one shared rule between them). The Admin's own forms
 * (src/components/admin/AdminPayoutActionForm.tsx,
 * AdminRefundCompleteForm.tsx) import them too, to disable their submit
 * button and show the same message before the request ever leaves the
 * browser. None of the three copies another's rule: a screen that warned
 * about one shape while the server enforced another is exactly what
 * @/lib/payout-balance-rule.ts's own doc comment (`exceedsPayoutBalance`)
 * warns against, and this module is that same arrangement for the proof
 * instead of the amount. `buildProofImage` is the one place the two
 * validated fields become the single string each row's own `proofImage`
 * column stores (no migration for Payout; ticket 13's answer only asked for
 * a structured value, not a new column -- Refund's `proofImage` is new,
 * ticket 31, for the same reason: the column did not exist before there was
 * a completion step to fill it).
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
