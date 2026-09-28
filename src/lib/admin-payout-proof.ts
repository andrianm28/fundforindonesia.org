/**
 * The structured note ticket 13 decided a Payout's proof of transfer has to
 * be: a transaction reference plus a free sentence, the same shape
 * `cleanProofReference` gives a Manual Contribution
 * (src/lib/money/manual-contributions.ts) -- "aturan `cleanProofReference`-
 * style", per the owner's 2026-09-28 answer
 * (.scratch/rilis-1-benda/issues/13-what-counts-as-proof-that-the-money-moved.md).
 *
 * `completePayout` (src/lib/money/payouts.ts) still only refuses a blank
 * `proofImage` string -- giving it the same shape as Manual Contribution's
 * validation is ticket 21's own money-lib change to make, and ticket 21's
 * brief says to stop and report rather than guess at one. So this module is
 * where the structure is actually asked for today: on the Admin's complete
 * form, which collects both fields separately and refuses to submit until
 * both pass, then joins them into the one string the API still accepts.
 * Nothing here changes what the server enforces.
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
