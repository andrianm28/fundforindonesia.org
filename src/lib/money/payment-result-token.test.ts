import { describe, it, expect } from 'vitest';
import {
  PAYMENT_RESULT_TTL_SECONDS,
  paymentResultPath,
  signPaymentResultToken,
  verifyPaymentResultToken,
} from './payment-result-token';

const SECRET = 'test-secret-for-payment-result';
const NOW = Date.UTC(2026, 9, 16, 10, 0, 0);

describe('payment result token (ticket 98)', () => {
  it('verifies back to the Donation it was signed for', () => {
    const token = signPaymentResultToken('cmdonation123', NOW, SECRET);
    expect(verifyPaymentResultToken(token, NOW + 60_000, SECRET)).toBe('cmdonation123');
  });

  it('does not contain the Donation id in a form that can be swapped for another', () => {
    const token = signPaymentResultToken('cmdonation123', NOW, SECRET);
    const [, signature] = token.split('.');
    const forgedPayload = Buffer.from(`${Math.floor(NOW / 1000) + 3600}:cmdonation999`, 'utf8').toString('base64url');
    expect(verifyPaymentResultToken(`${forgedPayload}.${signature}`, NOW, SECRET)).toBeNull();
  });

  it('is refused after it expires', () => {
    const token = signPaymentResultToken('cmdonation123', NOW, SECRET);
    expect(verifyPaymentResultToken(token, NOW + PAYMENT_RESULT_TTL_SECONDS * 1000 - 1000, SECRET)).toBe('cmdonation123');
    expect(verifyPaymentResultToken(token, NOW + PAYMENT_RESULT_TTL_SECONDS * 1000, SECRET)).toBeNull();
  });

  it('is refused when signed with another secret', () => {
    const token = signPaymentResultToken('cmdonation123', NOW, 'another-secret');
    expect(verifyPaymentResultToken(token, NOW, SECRET)).toBeNull();
  });

  it('refuses malformed input without throwing', () => {
    for (const junk of [undefined, null, 42, '', 'abc', 'a.b.c', 'cmdonation123', '!!.??', 'x'.repeat(600)]) {
      expect(verifyPaymentResultToken(junk, NOW, SECRET)).toBeNull();
    }
  });

  it('builds the page path, with a cancel marker when the donor backed out', () => {
    const token = signPaymentResultToken('cmdonation123', NOW, SECRET);
    expect(paymentResultPath(token)).toBe(`/donasi/hasil/${token}`);
    expect(paymentResultPath(token, { cancelled: true })).toBe(`/donasi/hasil/${token}?batal=1`);
  });
});
