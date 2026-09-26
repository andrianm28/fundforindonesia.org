import { describe, it, expect } from 'vitest';
import { computePlatformFee, floorFeeShare, formatFeePercent, BPS_DENOMINATOR } from './platform-fee';

/**
 * Pure Platform Fee math (CONTEXT.md, Platform Fee; prd-compliance 17):
 * rounded down so the remainder falls to the Campaign, waived below the
 * Admin-set threshold.
 */

describe('floorFeeShare', () => {
  it('takes percentBps of an amount, rounding down', () => {
    // 250 bps = 2.5% of 100_000 = 2_500 exactly.
    expect(floorFeeShare(100_000, 250)).toBe(2_500);
  });

  it('rounds the remainder down to the campaign rather than up to the platform', () => {
    // 2.5% of 100_001 = 2_500.025 -- must floor to 2_500, never ceil to 2_501.
    expect(floorFeeShare(100_001, 250)).toBe(2_500);
  });

  it('is 0 for a 0 bps rate', () => {
    expect(floorFeeShare(1_000_000, 0)).toBe(0);
  });

  it('handles amounts too large for float multiplication to stay exact', () => {
    // 9_999_999_999 * 9_999 exceeds Number.MAX_SAFE_INTEGER territory for a
    // naive float multiply; BigInt keeps this exact.
    const amount = 9_999_999_999;
    const bps = 9_999;
    const expected = (BigInt(amount) * BigInt(bps)) / BigInt(BPS_DENOMINATOR);
    expect(BigInt(floorFeeShare(amount, bps))).toBe(expected);
  });

  it('refuses a non-integer amount', () => {
    expect(() => floorFeeShare(100.5, 250)).toThrow(RangeError);
  });

  it('refuses a negative percentBps', () => {
    expect(() => floorFeeShare(100_000, -1)).toThrow(RangeError);
  });
});

describe('computePlatformFee', () => {
  it('is waived entirely below the Admin-set threshold', () => {
    expect(
      computePlatformFee({ grossAmount: 49_999, percentBps: 250, thresholdAmount: 50_000 }),
    ).toBe(0);
  });

  it('applies the rate at and above the threshold', () => {
    expect(
      computePlatformFee({ grossAmount: 50_000, percentBps: 250, thresholdAmount: 50_000 }),
    ).toBe(1_250);
  });

  it('is 0 with no threshold set (0) and a positive amount, when the rate itself is 0', () => {
    expect(
      computePlatformFee({ grossAmount: 100_000, percentBps: 0, thresholdAmount: 0 }),
    ).toBe(0);
  });

  it('rounds down so the remainder falls to the Campaign', () => {
    // 2.5% of 33_333 = 833.325
    expect(
      computePlatformFee({ grossAmount: 33_333, percentBps: 250, thresholdAmount: 0 }),
    ).toBe(833);
  });
});

describe('formatFeePercent', () => {
  it('formats 250 bps as 2,5%', () => {
    expect(formatFeePercent(250)).toBe('2,5%');
  });

  it('formats 0 bps as 0%', () => {
    expect(formatFeePercent(0)).toBe('0%');
  });

  it('formats a whole percent without a trailing decimal', () => {
    expect(formatFeePercent(500)).toBe('5%');
  });
});
