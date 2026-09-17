import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatRupiah, parseRupiah } from './currency';

/**
 * Property-based tests for Currency Formatting utilities.
 * **Validates: Requirements 14.2, 3.5**
 */
describe('Currency Formatting Properties', () => {
  /**
   * Property 3: Currency Formatting Round-Trip
   * For any non-negative integer amount (0 to 10^12),
   * parseRupiah(formatRupiah(amount)) === amount
   */
  it('round-trip: parseRupiah(formatRupiah(amount)) === amount for non-negative integers up to 10^12', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000_000 }),
        (amount) => {
          const formatted = formatRupiah(amount);
          const parsed = parseRupiah(formatted);
          expect(parsed).toBe(amount);
        }
      ),
      { numRuns: 1000 }
    );
  });

  /**
   * formatRupiah always starts with "Rp" prefix for non-negative values.
   */
  it('formatRupiah always starts with "Rp" for non-negative integers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000_000 }),
        (amount) => {
          const formatted = formatRupiah(amount);
          expect(formatted.startsWith('Rp')).toBe(true);
        }
      ),
      { numRuns: 1000 }
    );
  });

  /**
   * formatRupiah uses periods as thousands separators for amounts >= 1000.
   */
  it('formatRupiah uses periods as thousands separators', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 1_000_000_000_000 }),
        (amount) => {
          const formatted = formatRupiah(amount);
          // Strip the "Rp" prefix to inspect the numeric portion
          const numericPart = formatted.replace(/^Rp/, '');
          // Should contain at least one period as thousands separator
          expect(numericPart).toContain('.');
          // Each group between periods (except possibly the first) should be exactly 3 digits
          const groups = numericPart.split('.');
          // First group can be 1-3 digits
          expect(groups[0].length).toBeGreaterThanOrEqual(1);
          expect(groups[0].length).toBeLessThanOrEqual(3);
          // All subsequent groups must be exactly 3 digits
          for (let i = 1; i < groups.length; i++) {
            expect(groups[i].length).toBe(3);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });
});
