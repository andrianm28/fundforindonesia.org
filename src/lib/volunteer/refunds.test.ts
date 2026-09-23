import { describe, it, expect } from 'vitest';
import { tripFeeRefundAmount } from './refunds';

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
