import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateCollectedAmount, DonationRecord } from './donation-invariant';

/**
 * Property-Based Tests for Donation Amount Invariant
 * **Validates: Requirements 4.3, 6.5, 20.5**
 *
 * Property 1: Donation Amount Invariant
 * For any array of donations with mixed payment statuses,
 * the sum of confirmed donations always equals collectedAmount.
 */

const donationRecordArb: fc.Arbitrary<DonationRecord> = fc.record({
  amount: fc.integer({ min: 1000, max: 10_000_000 }),
  paymentStatus: fc.constantFrom('pending' as const, 'confirmed' as const, 'failed' as const),
});

describe('Property 1: Donation Amount Invariant', () => {
  it('sum of confirmed donations always equals calculateCollectedAmount result', () => {
    fc.assert(
      fc.property(
        fc.array(donationRecordArb, { minLength: 0, maxLength: 100 }),
        (donations) => {
          const result = calculateCollectedAmount(donations);
          const manualSum = donations
            .filter(d => d.paymentStatus === 'confirmed')
            .reduce((sum, d) => sum + d.amount, 0);
          expect(result).toBe(manualSum);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('result only includes confirmed donations, not pending or failed', () => {
    fc.assert(
      fc.property(
        fc.array(donationRecordArb, { minLength: 1, maxLength: 100 }),
        (donations) => {
          const result = calculateCollectedAmount(donations);

          // Sum of only pending and failed should not be in the result
          const pendingAndFailedSum = donations
            .filter(d => d.paymentStatus !== 'confirmed')
            .reduce((sum, d) => sum + d.amount, 0);

          const confirmedSum = donations
            .filter(d => d.paymentStatus === 'confirmed')
            .reduce((sum, d) => sum + d.amount, 0);

          // The result must equal the confirmed sum exactly
          expect(result).toBe(confirmedSum);

          // If there are no confirmed donations, result should be 0
          // regardless of pending/failed amounts
          const hasConfirmed = donations.some(d => d.paymentStatus === 'confirmed');
          if (!hasConfirmed) {
            expect(result).toBe(0);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('result is always non-negative', () => {
    fc.assert(
      fc.property(
        fc.array(donationRecordArb, { minLength: 0, maxLength: 100 }),
        (donations) => {
          const result = calculateCollectedAmount(donations);
          expect(result).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 1000 }
    );
  });
});
