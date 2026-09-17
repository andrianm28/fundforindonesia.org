import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateZakat } from './zakat';

/**
 * Property 10: Zakat Calculation Correctness
 * 
 * For any asset value and nisab threshold, the Zakat calculator SHALL return
 * exactly 2.5% of (assets - nisab) when assets exceed nisab, and 0 when assets
 * are at or below nisab. The result SHALL always be a non-negative integer.
 *
 * **Validates: Requirements 15.3**
 */
describe('Property 10: Zakat Calculation Correctness', () => {
  it('returns Math.round((assets - nisab) * 0.025) when assets > nisab', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 9_999_999_999 }),
        (assets, nisab) => {
          fc.pre(assets > nisab);
          const expected = Math.round((assets - nisab) * 0.025);
          const result = calculateZakat(assets, nisab);
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('returns 0 when assets <= nisab', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 10_000_000_000 }),
        (assets, nisab) => {
          fc.pre(assets <= nisab);
          const result = calculateZakat(assets, nisab);
          expect(result).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('result is always a non-negative integer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 10_000_000_000 }),
        (assets, nisab) => {
          const result = calculateZakat(assets, nisab);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(result)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});
