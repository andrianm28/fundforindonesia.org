import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { incrementAmiin } from './amiin-count';

/**
 * Property-Based Tests for Amiin Count Monotonic Increment
 * **Validates: Requirements 9.3**
 *
 * Property 7: Amiin Count Monotonic Increment
 * Generate random starting counts, apply amiin operation and verify:
 * - Count becomes exactly N + 1
 * - Count never decreases
 * - Result is always non-negative
 * - Applying N times results in originalCount + N
 */

describe('Property 7: Amiin Count Monotonic Increment', () => {
  it('result is exactly currentCount + 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        (currentCount) => {
          const result = incrementAmiin(currentCount);

          expect(result).toBe(currentCount + 1);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('result is always greater than currentCount (never decreases)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        (currentCount) => {
          const result = incrementAmiin(currentCount);

          expect(result).toBeGreaterThan(currentCount);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('result is always non-negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        (currentCount) => {
          const result = incrementAmiin(currentCount);

          expect(result).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('applying N times results in originalCount + N', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100 }),
        (originalCount, n) => {
          let count = originalCount;

          for (let i = 0; i < n; i++) {
            count = incrementAmiin(count);
          }

          expect(count).toBe(originalCount + n);
        }
      ),
      { numRuns: 1000 }
    );
  });
});
