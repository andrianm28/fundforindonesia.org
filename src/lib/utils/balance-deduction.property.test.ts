import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deductBalance } from './balance-deduction';

/**
 * Property-Based Tests for Balance Deduction Integrity
 * **Validates: Requirements 16.6, 20.5**
 *
 * Property 11: Balance Deduction Integrity
 * Generate random (balance, donationAmount) pairs and verify:
 * - If amount <= balance, new balance = balance - amount
 * - If amount > balance, transaction rejected and balance unchanged
 */

describe('Property 11: Balance Deduction Integrity', () => {
  it('when amount <= balance, success is true and newBalance = balance - amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (balance, amount) => {
          fc.pre(amount <= balance);

          const result = deductBalance(balance, amount);

          expect(result.success).toBe(true);
          expect(result.newBalance).toBe(balance - amount);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('when amount > balance, success is false and newBalance = balance (unchanged)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        (balance, extra) => {
          const amount = balance + extra; // guarantees amount > balance

          const result = deductBalance(balance, amount);

          expect(result.success).toBe(false);
          expect(result.newBalance).toBe(balance);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('newBalance is always non-negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (balance, amount) => {
          const result = deductBalance(balance, amount);

          expect(result.newBalance).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 1000 }
    );
  });
});
