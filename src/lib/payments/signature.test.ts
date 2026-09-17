import { describe, it, expect } from 'vitest';
import { computeMidtransSignature, verifyMidtransSignature } from './signature';

/**
 * The signature is the only thing standing between "a provider told us this
 * was paid" and "anyone with the URL told us this was paid", so it is tested
 * against the algorithm as documented rather than against itself.
 */

// Midtrans' own worked example from its notification docs.
const DOC_EXAMPLE = {
  orderId: 'SIGNATURE-TEST',
  statusCode: '200',
  grossAmount: '100000.00',
};
const DOC_SERVER_KEY = 'SB-Mid-server-TEST';

describe('computeMidtransSignature', () => {
  it('is SHA-512 of order_id + status_code + gross_amount + server_key', async () => {
    // Computed independently from the documented concatenation, not copied
    // from this implementation's output -- a test that asserts the code
    // matches itself proves nothing.
    const expected = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-512',
          new TextEncoder().encode(
            `${DOC_EXAMPLE.orderId}${DOC_EXAMPLE.statusCode}${DOC_EXAMPLE.grossAmount}${DOC_SERVER_KEY}`,
          ),
        ),
      ),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    await expect(computeMidtransSignature(DOC_EXAMPLE, DOC_SERVER_KEY)).resolves.toBe(expected);
  });

  it('produces 128 hex characters', async () => {
    const sig = await computeMidtransSignature(DOC_EXAMPLE, DOC_SERVER_KEY);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
  });

  it('changes when any signed field changes', async () => {
    const base = await computeMidtransSignature(DOC_EXAMPLE, DOC_SERVER_KEY);
    const variants = [
      { ...DOC_EXAMPLE, orderId: 'SIGNATURE-TES' },
      { ...DOC_EXAMPLE, statusCode: '201' },
      // The amount matters most: an attacker who could change it without
      // breaking the signature could settle a Rp 1.000 charge as Rp 1.000.000.
      { ...DOC_EXAMPLE, grossAmount: '1000000.00' },
    ];
    for (const v of variants) {
      await expect(computeMidtransSignature(v, DOC_SERVER_KEY)).resolves.not.toBe(base);
    }
    await expect(computeMidtransSignature(DOC_EXAMPLE, 'other-key')).resolves.not.toBe(base);
  });
});

describe('verifyMidtransSignature', () => {
  it('accepts a signature it just produced', async () => {
    const sig = await computeMidtransSignature(DOC_EXAMPLE, DOC_SERVER_KEY);
    await expect(verifyMidtransSignature(DOC_EXAMPLE, sig, DOC_SERVER_KEY)).resolves.toBe(true);
  });

  it('rejects a signature computed with a different server key', async () => {
    const forged = await computeMidtransSignature(DOC_EXAMPLE, 'attacker-guess');
    await expect(verifyMidtransSignature(DOC_EXAMPLE, forged, DOC_SERVER_KEY)).resolves.toBe(false);
  });

  it('rejects a truncated, padded, empty, or altered signature', async () => {
    const sig = await computeMidtransSignature(DOC_EXAMPLE, DOC_SERVER_KEY);
    const bad = [
      sig.slice(0, -1),
      `${sig}0`,
      '',
      `${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`,
    ];
    for (const candidate of bad) {
      await expect(verifyMidtransSignature(DOC_EXAMPLE, candidate, DOC_SERVER_KEY)).resolves.toBe(
        false,
      );
    }
  });
});
