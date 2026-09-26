import { describe, it, expect } from 'vitest';
import { tripFeeRefund, tripFeeRefundAmount } from './refunds';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-01T00:00:00.000Z');

function departureDaysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

describe('tripFeeRefundAmount', () => {
  it('refunds in full at exactly 14 days before departure', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(14), now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(100_000);
  });

  it('refunds in full further than 14 days before departure', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(60), now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(100_000);
  });

  it('refunds half just under 14 days before departure', () => {
    const departureDate = new Date(departureDaysFromNow(14).getTime() - 1);
    const amount = tripFeeRefundAmount({ departureDate, now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(50_000);
  });

  it('refunds half at exactly 3 days before departure', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(3), now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(50_000);
  });

  it('rounds a half-refund down to the nearest Rupiah', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(3), now: NOW, paidAmount: 100_001 });
    expect(amount).toBe(50_000);
  });

  it('refunds nothing just under 3 days before departure', () => {
    const departureDate = new Date(departureDaysFromNow(3).getTime() - 1);
    const amount = tripFeeRefundAmount({ departureDate, now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(0);
  });

  it('refunds nothing on the departure date itself', () => {
    const amount = tripFeeRefundAmount({ departureDate: NOW, now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(0);
  });

  it('refunds nothing after departure has already passed', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(-5), now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(0);
  });
});

describe('tripFeeRefund: the one Trip Fee Refund policy', () => {
  function paidRegistration(departureInDays: number, amount = 100_000) {
    return { batch: { startDate: departureDaysFromNow(departureInDays) }, payment: { amount } };
  }

  describe('volunteer cancel: tiered by time to departure', () => {
    it.each([
      ['14 days out', 14, 100_000],
      ['a millisecond under 14 days', 14 - 1 / DAY_MS, 50_000],
      ['3 days out', 3, 50_000],
      ['a millisecond under 3 days', 3 - 1 / DAY_MS, 0],
      ['on the departure date', 0, 0],
    ])('refunds %s as %i', (_label, days, expected) => {
      expect(tripFeeRefund(paidRegistration(days), 'volunteer cancel', NOW)).toEqual({
        amount: expected,
        reason: 'Volunteer membatalkan Registrasi',
      });
    });
  });

  it('batch cancel: refunds the full Trip Fee, even a day before departure', () => {
    expect(tripFeeRefund(paidRegistration(1, 175_000), 'batch cancel', NOW)).toEqual({
      amount: 175_000,
      reason: 'Batch dibatalkan karena tidak mencapai kuota minimum',
    });
  });

  it('late settlement: refunds the full Trip Fee, even after departure', () => {
    expect(tripFeeRefund(paidRegistration(-5, 250_000), 'late settlement', NOW)).toEqual({
      amount: 250_000,
      reason: 'Trip Fee settlement arrived after the Registration was already cancelled -- refunded automatically',
    });
  });
});
