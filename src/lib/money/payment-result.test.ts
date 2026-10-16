import { describe, it, expect } from 'vitest';
import { describePaymentResult, type ResultPayment } from './payment-result';

const NOW = new Date('2026-10-16T10:00:00.000Z');
const LATER = new Date('2026-10-17T10:00:00.000Z');
const EARLIER = new Date('2026-10-16T09:00:00.000Z');

function payment(overrides: Partial<ResultPayment> = {}): ResultPayment {
  return {
    status: 'PENDING',
    expiresAt: LATER,
    redirectUrl: 'https://pay.example/order-1',
    createdAt: new Date('2026-10-16T09:30:00.000Z'),
    ...overrides,
  };
}

describe('describePaymentResult (ticket 98)', () => {
  it('waits while the latest Payment is open, offering its own payment link back', () => {
    expect(describePaymentResult({ paymentStatus: 'pending', payments: [payment()] }, NOW)).toEqual({
      state: 'menunggu',
      canRetry: false,
      continueUrl: 'https://pay.example/order-1',
    });
  });

  it('offers no link back when none was kept, or when it is not https', () => {
    for (const redirectUrl of [null, 'javascript:alert(1)', 'http://pay.example/x']) {
      expect(describePaymentResult({ paymentStatus: 'pending', payments: [payment({ redirectUrl })] }, NOW).continueUrl).toBeNull();
    }
  });

  it('is settled once any Payment on the Donation is PAID, whatever came after it', () => {
    const result = describePaymentResult(
      {
        paymentStatus: 'confirmed',
        payments: [
          payment({ status: 'PAID', createdAt: EARLIER }),
          payment({ status: 'EXPIRED', createdAt: NOW }),
        ],
      },
      NOW,
    );
    expect(result).toEqual({ state: 'berhasil', canRetry: false, continueUrl: null });
  });

  it('says the money went back when the Payment was refunded', () => {
    expect(describePaymentResult({ paymentStatus: 'confirmed', payments: [payment({ status: 'REFUNDED' })] }, NOW).state).toBe(
      'dikembalikan',
    );
  });

  it('offers a retry on a failed or expired latest Payment', () => {
    expect(describePaymentResult({ paymentStatus: 'pending', payments: [payment({ status: 'FAILED' })] }, NOW)).toEqual({
      state: 'gagal',
      canRetry: true,
      continueUrl: null,
    });
    expect(describePaymentResult({ paymentStatus: 'pending', payments: [payment({ status: 'EXPIRED' })] }, NOW)).toEqual({
      state: 'kedaluwarsa',
      canRetry: true,
      continueUrl: null,
    });
  });

  it('judges a PENDING Payment past its window as expired, as the retry route does', () => {
    expect(describePaymentResult({ paymentStatus: 'pending', payments: [payment({ expiresAt: EARLIER })] }, NOW)).toEqual({
      state: 'kedaluwarsa',
      canRetry: true,
      continueUrl: null,
    });
  });

  it('reads the newest attempt, not the first', () => {
    const result = describePaymentResult(
      {
        paymentStatus: 'pending',
        payments: [payment({ status: 'EXPIRED', createdAt: EARLIER }), payment({ createdAt: NOW })],
      },
      NOW,
    );
    expect(result.state).toBe('menunggu');
  });

  it('is failed with nothing to retry when no charge was ever created', () => {
    expect(describePaymentResult({ paymentStatus: 'failed', payments: [] }, NOW)).toEqual({
      state: 'gagal',
      canRetry: false,
      continueUrl: null,
    });
  });
});
