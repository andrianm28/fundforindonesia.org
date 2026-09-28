import { describe, it, expect } from 'vitest';
import {
  MAX_PROOF_REFERENCE_LENGTH,
  MAX_PROOF_NOTE_LENGTH,
  validateProofReference,
  validateProofNote,
  buildProofImage,
} from './admin-payout-proof';

/**
 * Ticket 13's answer: a Payout's proof is a structured note now (a
 * transaction reference plus a free sentence, cleanProofReference-style),
 * not one typed character. `src/lib/money/payouts.ts` still only refuses a
 * blank string (ticket 21 leaves that lib change to a dedicated ticket per
 * the coordinator's brief), so this module is where the structure is
 * actually enforced today: on the Admin's own form, before the string ever
 * reaches the API.
 */
describe('validateProofReference', () => {
  it('refuses a blank reference', () => {
    expect(validateProofReference('')).toBe('Referensi transaksi wajib diisi.');
    expect(validateProofReference('   ')).toBe('Referensi transaksi wajib diisi.');
  });

  it('accepts a trimmed non-blank reference', () => {
    expect(validateProofReference('  TRX-001  ')).toBeNull();
  });

  it('refuses a reference over the length limit', () => {
    const tooLong = 'a'.repeat(MAX_PROOF_REFERENCE_LENGTH + 1);
    expect(validateProofReference(tooLong)).toBe(
      `Referensi transaksi paling panjang ${MAX_PROOF_REFERENCE_LENGTH} karakter.`,
    );
  });

  it('accepts a reference exactly at the length limit', () => {
    const atLimit = 'a'.repeat(MAX_PROOF_REFERENCE_LENGTH);
    expect(validateProofReference(atLimit)).toBeNull();
  });
});

describe('validateProofNote', () => {
  it('refuses a blank note -- FFI-07 asks for a note, not just a reference', () => {
    expect(validateProofNote('')).toBe('Catatan wajib diisi.');
    expect(validateProofNote('  ')).toBe('Catatan wajib diisi.');
  });

  it('accepts a trimmed non-blank note', () => {
    expect(validateProofNote('  Ditransfer lewat mobile banking BCA.  ')).toBeNull();
  });

  it('refuses a note over the length limit', () => {
    const tooLong = 'a'.repeat(MAX_PROOF_NOTE_LENGTH + 1);
    expect(validateProofNote(tooLong)).toBe(`Catatan paling panjang ${MAX_PROOF_NOTE_LENGTH} karakter.`);
  });
});

describe('buildProofImage', () => {
  it('combines a trimmed reference and note into one string', () => {
    expect(buildProofImage('TRX-001', 'Ditransfer via BCA')).toBe('TRX-001 — Ditransfer via BCA');
  });

  it('trims both fields before combining', () => {
    expect(buildProofImage('  TRX-001  ', '  Ditransfer via BCA  ')).toBe('TRX-001 — Ditransfer via BCA');
  });
});
