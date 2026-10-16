import { describe, it, expect } from 'vitest';
import { attemptRetryable, describePaymentResult, EXPIRY_GRACE_MS, type ResultPayment } from './payment-result';

const NOW = new Date('2026-10-16T10:00:00.000Z');
const LATER = new Date('2026-10-17T10:00:00.000Z');
const EARLIER = new Date('2026-10-16T09:00:00.000Z');

function payment(overrides: Partial<ResultPayment> = {}): ResultPayment {
  return {
    status: 'PENDING',
    expiresAt: LATER,
    redirectUrl: 'https://pay.example/order-1',
    vaNumber: null,
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
      vaNumber: null,
    });
  });

  it('offers no link back when none was kept, or when it is not https', () => {
    for (const redirectUrl of [null, 'javascript:alert(1)', 'http://pay.example/x']) {
      expect(describePaymentResult({ paymentStatus: 'pending', payments: [payment({ redirectUrl })] }, NOW).continueUrl).toBeNull();
    }
  });

  it('gives the Virtual Account number of an open bank transfer', () => {
    const result = describePaymentResult(
      { paymentStatus: 'pending', payments: [payment({ redirectUrl: null, vaNumber: '8808123456789' })] },
      NOW,
    );
    expect(result).toEqual({ state: 'menunggu', canRetry: false, continueUrl: null, vaNumber: '8808123456789' });
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
    expect(result).toEqual({ state: 'berhasil', canRetry: false, continueUrl: null, vaNumber: null });
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
      vaNumber: null,
    });
    expect(
      describePaymentResult({ paymentStatus: 'pending', payments: [payment({ status: 'EXPIRED', expiresAt: EARLIER })] }, NOW),
    ).toEqual({
      state: 'kedaluwarsa',
      canRetry: true,
      continueUrl: null,
      vaNumber: null,
    });
  });

  it('judges a PENDING Payment past its window as expired, as the retry route does', () => {
    expect(describePaymentResult({ paymentStatus: 'pending', payments: [payment({ expiresAt: EARLIER })] }, NOW)).toEqual({
      state: 'kedaluwarsa',
      canRetry: true,
      continueUrl: null,
      vaNumber: null,
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
      vaNumber: null,
    });
  });

  it('keeps the Donor waiting, with no second charge, for the grace period after expiry (PR #273 review S4)', () => {
    const justExpired = new Date(NOW.getTime() - 60_000);
    for (const status of ['PENDING', 'EXPIRED'] as const) {
      expect(
        describePaymentResult({ paymentStatus: 'pending', payments: [payment({ status, expiresAt: justExpired })] }, NOW),
      ).toEqual({ state: 'menunggu', canRetry: false, continueUrl: null, vaNumber: null });
    }
  });
});

describe('attemptRetryable', () => {
  const expiredAt = new Date('2026-10-16T09:00:00.000Z');
  const atGraceEnd = new Date(expiredAt.getTime() + EXPIRY_GRACE_MS);

  it('opens exactly when the grace period ends, not a millisecond before', () => {
    expect(attemptRetryable({ status: 'EXPIRED', expiresAt: expiredAt }, new Date(atGraceEnd.getTime() - 1))).toBe(false);
    expect(attemptRetryable({ status: 'EXPIRED', expiresAt: expiredAt }, atGraceEnd)).toBe(true);
    expect(attemptRetryable({ status: 'PENDING', expiresAt: expiredAt }, atGraceEnd)).toBe(true);
  });

  it('retries a FAILED attempt at once and never a PAID, REFUNDED or open one', () => {
    expect(attemptRetryable({ status: 'FAILED', expiresAt: NOW }, NOW)).toBe(true);
    expect(attemptRetryable({ status: 'PAID', expiresAt: expiredAt }, NOW)).toBe(false);
    expect(attemptRetryable({ status: 'REFUNDED', expiresAt: expiredAt }, NOW)).toBe(false);
    expect(attemptRetryable({ status: 'PENDING', expiresAt: null }, NOW)).toBe(false);
    expect(attemptRetryable({ status: 'EXPIRED', expiresAt: null }, NOW)).toBe(true);
  });
});
