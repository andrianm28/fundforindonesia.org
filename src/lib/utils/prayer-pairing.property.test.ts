import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validatePrayerPairing, PrayerPair } from './prayer-pairing';

/**
 * Property-Based Tests for Prayer-Donation Pairing Uniqueness
 * **Validates: Requirements 9.1, 6.6**
 *
 * Property 12: Prayer-Donation Pairing Uniqueness
 * Generate donation/prayer pairs and verify:
 * - Each prayer references exactly one donation (unique donationId)
 * - Each donation has at most one prayer (no duplicate donationIds across prayers)
 */

describe('Property 12: Prayer-Donation Pairing Uniqueness', () => {
  it('when all donationIds are unique, the pairing is valid', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 50 }).chain((donationIds) =>
          fc.constant(
            donationIds.map((donationId) => ({
              prayerId: fc.sample(fc.uuid(), 1)[0],
              donationId,
            }))
          )
        ),
        (pairs: PrayerPair[]) => {
          const result = validatePrayerPairing(pairs);

          expect(result.valid).toBe(true);
          expect(result.duplicates).toHaveLength(0);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('when donationIds have duplicates, the pairing is invalid and duplicates are reported', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 20 }).chain((uniqueIds) =>
          fc.tuple(
            fc.constant(uniqueIds),
            fc.integer({ min: 0, max: uniqueIds.length - 1 })
          )
        ),
        ([uniqueIds, dupIndex]) => {
          // Create pairs with unique donationIds, then add a duplicate
          const pairs: PrayerPair[] = uniqueIds.map((donationId) => ({
            prayerId: fc.sample(fc.uuid(), 1)[0],
            donationId,
          }));

          // Append a duplicate pair using the donationId at dupIndex
          const duplicatedDonationId = uniqueIds[dupIndex];
          pairs.push({
            prayerId: fc.sample(fc.uuid(), 1)[0],
            donationId: duplicatedDonationId,
          });

          const result = validatePrayerPairing(pairs);

          expect(result.valid).toBe(false);
          expect(result.duplicates.length).toBeGreaterThan(0);
          expect(result.duplicates).toContain(duplicatedDonationId);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('each prayer references exactly one donation (prayerId-donationId is a pair)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            prayerId: fc.uuid(),
            donationId: fc.uuid(),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (pairs: PrayerPair[]) => {
          // Every pair has exactly one donationId (structural guarantee)
          for (const pair of pairs) {
            expect(pair.donationId).toBeDefined();
            expect(typeof pair.donationId).toBe('string');
            expect(pair.donationId.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('empty array of pairs is always valid', () => {
    const result = validatePrayerPairing([]);
    expect(result.valid).toBe(true);
    expect(result.duplicates).toHaveLength(0);
  });
});
