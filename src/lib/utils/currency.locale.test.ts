import { describe, it, expect } from 'vitest';
import { formatRupiah } from './currency';

describe('formatRupiah per language (ADR 0024 section 5)', () => {
  it('defaults to the Indonesian form, so every existing caller is unchanged', () => {
    expect(formatRupiah(25841000)).toBe('Rp25.841.000');
    expect(formatRupiah(25841000, 'id')).toBe('Rp25.841.000');
  });

  it('only changes the grouping separator for English', () => {
    expect(formatRupiah(25841000, 'en')).toBe('Rp25,841,000');
    expect(formatRupiah(0, 'en')).toBe('Rp0');
    expect(formatRupiah(999, 'en')).toBe('Rp999');
    expect(formatRupiah(-50000, 'en')).toBe('-Rp50,000');
  });
});
