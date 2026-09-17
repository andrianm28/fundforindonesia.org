import { describe, it, expect } from 'vitest';
import { formatRupiah, parseRupiah } from './currency';

describe('formatRupiah', () => {
  it('formats zero', () => {
    expect(formatRupiah(0)).toBe('Rp0');
  });

  it('formats small numbers without separator', () => {
    expect(formatRupiah(500)).toBe('Rp500');
  });

  it('formats thousands with period separator', () => {
    expect(formatRupiah(1000)).toBe('Rp1.000');
    expect(formatRupiah(50000)).toBe('Rp50.000');
  });

  it('formats millions', () => {
    expect(formatRupiah(25841000)).toBe('Rp25.841.000');
    expect(formatRupiah(1000000)).toBe('Rp1.000.000');
  });

  it('formats very large numbers (up to 10^12)', () => {
    expect(formatRupiah(1000000000000)).toBe('Rp1.000.000.000.000');
  });

  it('formats negative numbers', () => {
    expect(formatRupiah(-50000)).toBe('-Rp50.000');
  });
});

describe('parseRupiah', () => {
  it('parses zero', () => {
    expect(parseRupiah('Rp0')).toBe(0);
  });

  it('parses small numbers', () => {
    expect(parseRupiah('Rp500')).toBe(500);
  });

  it('parses thousands', () => {
    expect(parseRupiah('Rp1.000')).toBe(1000);
    expect(parseRupiah('Rp50.000')).toBe(50000);
  });

  it('parses millions', () => {
    expect(parseRupiah('Rp25.841.000')).toBe(25841000);
  });

  it('parses very large numbers', () => {
    expect(parseRupiah('Rp1.000.000.000.000')).toBe(1000000000000);
  });

  it('parses negative formatted values', () => {
    expect(parseRupiah('-Rp50.000')).toBe(-50000);
  });
});

describe('round-trip property', () => {
  it('parseRupiah(formatRupiah(x)) === x for non-negative integers', () => {
    const testValues = [0, 1, 999, 1000, 10000, 100000, 1000000, 25841000, 1000000000000];
    for (const value of testValues) {
      expect(parseRupiah(formatRupiah(value))).toBe(value);
    }
  });
});
