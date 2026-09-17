import { describe, it, expect } from 'vitest';
import { calculateZakat, calculateZakatFitrah } from './zakat';

describe('calculateZakat', () => {
  it('returns 0 when assets equal nisab', () => {
    expect(calculateZakat(85_000_000, 85_000_000)).toBe(0);
  });

  it('returns 0 when assets are below nisab', () => {
    expect(calculateZakat(50_000_000, 85_000_000)).toBe(0);
  });

  it('calculates 2.5% of excess above nisab', () => {
    // 100M - 85M = 15M × 0.025 = 375,000
    expect(calculateZakat(100_000_000, 85_000_000)).toBe(375_000);
  });

  it('rounds to nearest integer', () => {
    // 85_000_001 - 85_000_000 = 1 × 0.025 = 0.025 → rounds to 0
    expect(calculateZakat(85_000_001, 85_000_000)).toBe(0);
    // 85_000_100 - 85_000_000 = 100 × 0.025 = 2.5 → rounds to 3 (Math.round)
    expect(calculateZakat(85_000_100, 85_000_000)).toBe(3);
  });

  it('handles large asset values', () => {
    // 1B - 85M = 915M × 0.025 = 22,875,000
    expect(calculateZakat(1_000_000_000, 85_000_000)).toBe(22_875_000);
  });

  it('result is always non-negative', () => {
    expect(calculateZakat(0, 85_000_000)).toBe(0);
    expect(calculateZakat(-100, 85_000_000)).toBe(0);
  });
});

describe('calculateZakatFitrah', () => {
  it('calculates 3.5kg × price × people', () => {
    // 3.5 × 15000 × 1 = 52,500
    expect(calculateZakatFitrah(15_000)).toBe(52_500);
  });

  it('calculates for multiple people', () => {
    // 3.5 × 15000 × 4 = 210,000
    expect(calculateZakatFitrah(15_000, 4)).toBe(210_000);
  });

  it('defaults to 1 person', () => {
    expect(calculateZakatFitrah(10_000)).toBe(35_000);
  });

  it('returns 0 for zero or negative price', () => {
    expect(calculateZakatFitrah(0)).toBe(0);
    expect(calculateZakatFitrah(-1000)).toBe(0);
  });

  it('returns 0 for zero or negative people', () => {
    expect(calculateZakatFitrah(15_000, 0)).toBe(0);
    expect(calculateZakatFitrah(15_000, -1)).toBe(0);
  });

  it('rounds result to nearest integer', () => {
    // 3.5 × 14_285 × 1 = 49,997.5 → rounds to 49,998
    expect(calculateZakatFitrah(14_285)).toBe(49_998);
  });
});
