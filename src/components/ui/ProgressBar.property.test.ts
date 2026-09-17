import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculatePercentage } from './ProgressBar';

/**
 * Property-Based Tests for Progress Bar Accuracy
 * **Validates: Requirements 3.4, 4.4**
 *
 * Property 2: Progress Bar Accuracy
 * For any valid (collectedAmount, targetAmount) pair where targetAmount > 0,
 * the percentage SHALL equal Math.min((collectedAmount / targetAmount) * 100, 100),
 * never exceeding 100% and never negative.
 */
describe('Property 2: Progress Bar Accuracy', () => {
  it('result is always between 0 and 100 inclusive for positive target and non-negative current', () => {
    fc.assert(
      fc.property(
        fc.nat(), // non-negative collectedAmount
        fc.integer({ min: 1, max: 1_000_000_000 }), // positive targetAmount
        (collectedAmount, targetAmount) => {
          const result = calculatePercentage(collectedAmount, targetAmount);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('result equals Math.min((collectedAmount / targetAmount) * 100, 100)', () => {
    fc.assert(
      fc.property(
        fc.nat(), // non-negative collectedAmount
        fc.integer({ min: 1, max: 1_000_000_000 }), // positive targetAmount
        (collectedAmount, targetAmount) => {
          const result = calculatePercentage(collectedAmount, targetAmount);
          const expected = Math.min((collectedAmount / targetAmount) * 100, 100);
          expect(result).toBeCloseTo(expected, 10);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('result is never negative for any inputs', () => {
    fc.assert(
      fc.property(
        fc.integer(), // any integer (including negatives)
        fc.integer(), // any integer (including negatives and zero)
        (collectedAmount, targetAmount) => {
          const result = calculatePercentage(collectedAmount, targetAmount);
          expect(result).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 1000 }
    );
  });
});
