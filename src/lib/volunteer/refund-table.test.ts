import { describe, it, expect } from 'vitest';
import { refundTiers, formatBoundary, formatWibDate } from './refund-table';
import { tripFeeRefundAmount } from './refunds';

const DAY = 24 * 60 * 60 * 1000;
// 20 Oct 2026 07:00 WIB.
const START = new Date('2026-10-20T00:00:00Z');

describe('refundTiers', () => {
  it('shows three tiers with the real dates of this Batch and amounts of the Trip Fee', () => {
    const tiers = refundTiers({ startDate: START, tripFee: 2_500_000 });
    expect(tiers.map((t) => [t.key, t.amount])).toEqual([
      ['FULL', 2_500_000],
      ['HALF', 1_250_000],
      ['NONE', 0],
    ]);
    expect(tiers[0].window).toBe('Sampai 6 Okt 2026 07.00 WIB (14 hari penuh atau lebih sebelum berangkat)');
    expect(tiers[1].window).toBe(
      'Setelah 6 Okt 2026 07.00 WIB sampai 17 Okt 2026 07.00 WIB (3 sampai 13 hari sebelum berangkat)',
    );
    expect(tiers[2].window).toBe('Setelah 17 Okt 2026 07.00 WIB (kurang dari 3 hari sebelum berangkat)');
  });

  it('agrees with the policy at the exact boundary instants and one millisecond either side', () => {
    const [full, half] = refundTiers({ startDate: START, tripFee: 100_000 }).map((t) => t.amount);
    const at = (ms: number) =>
      tripFeeRefundAmount({ departureDate: START, now: new Date(START.getTime() - ms), paidAmount: 100_000 });
    expect(at(14 * DAY)).toBe(full);
    expect(at(14 * DAY + 1)).toBe(full);
    expect(at(14 * DAY - 1)).toBe(half);
    expect(at(3 * DAY)).toBe(half);
    expect(at(3 * DAY - 1)).toBe(0);
  });

  it('rounds the half tier down, never in the Volunteer favour', () => {
    expect(refundTiers({ startDate: START, tripFee: 100_001 })[1].amount).toBe(50_000);
  });
});

describe('formatBoundary', () => {
  it('renders in WIB, deterministic regardless of server timezone', () => {
    expect(formatBoundary(new Date('2026-12-31T20:30:00Z'))).toBe('1 Jan 2027 03.30 WIB');
  });
});

describe('formatWibDate', () => {
  it('shows the same WIB date as the tier boundary for a Batch starting at midnight WIB, in any process timezone', () => {
    // 20 Okt 2026 00:00 WIB = 19 Okt 17:00 UTC: a process-timezone getDate() in UTC would say 19.
    const start = new Date('2026-10-19T17:00:00Z');
    expect(formatWibDate(start)).toBe('20 Okt 2026');
    const [full] = refundTiers({ startDate: start, tripFee: 100_000 });
    expect(full.window).toContain('Sampai 6 Okt 2026 00.00 WIB');
    expect(formatWibDate(new Date(start.getTime() - 14 * DAY))).toBe('6 Okt 2026');
    expect(formatWibDate(new Date('2026-12-31T20:30:00Z'))).toBe('1 Jan 2027');
  });
});
