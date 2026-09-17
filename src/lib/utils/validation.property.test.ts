import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateDonationAmount } from './validation';

/**
 * Property-based tests for Donation Amount Validation (Property 5)
 *
 * **Validates: Requirements 6.8**
 *
 * Property 5: Donation Amount Validation
 * For any donation amount below the minimum threshold (Rp1.000), the validation
 * function SHALL reject it. For any amount at or above the minimum threshold and
 * at or below the maximum, the validation function SHALL accept it.
 */

const MIN_DONATION = 1000;
const MAX_DONATION = 1_000_000_000;

describe('Property 5: Donation Amount Validation', () => {
  it('rejects any integer amount below the minimum threshold (< 1000)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: MIN_DONATION - 1 }),
        (amount) => {
          const result = validateDonationAmount(amount);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }
      ),
      { numRuns: 200 }
    );
  });

  it('accepts any integer amount at or above minimum and at or below maximum (1000 <= amount <= 1,000,000,000)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_DONATION, max: MAX_DONATION }),
        (amount) => {
          const result = validateDonationAmount(amount);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        }
      ),
      { numRuns: 200 }
    );
  });

  it('rejects any integer amount above the maximum threshold (> 1,000,000,000)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_DONATION + 1, max: 2_000_000_000 }),
        (amount) => {
          const result = validateDonationAmount(amount);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }
      ),
      { numRuns: 200 }
    );
  });

  it('correctly handles boundary values (999, 1000, 1001)', () => {
    // 999 is below minimum - should be rejected
    const below = validateDonationAmount(999);
    expect(below.valid).toBe(false);
    expect(below.error).toBeDefined();

    // 1000 is exactly the minimum - should be accepted
    const atMin = validateDonationAmount(1000);
    expect(atMin.valid).toBe(true);

    // 1001 is above minimum - should be accepted
    const aboveMin = validateDonationAmount(1001);
    expect(aboveMin.valid).toBe(true);

    // Maximum boundary
    const atMax = validateDonationAmount(MAX_DONATION);
    expect(atMax.valid).toBe(true);

    const aboveMax = validateDonationAmount(MAX_DONATION + 1);
    expect(aboveMax.valid).toBe(false);
  });

  it('generates amounts around the Rp1.000 threshold boundary and validates correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 900, max: 1100 }),
        (amount) => {
          const result = validateDonationAmount(amount);
          if (amount < MIN_DONATION) {
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          } else {
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
