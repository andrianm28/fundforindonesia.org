import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sortPrayersChronologically, PrayerWithTimestamp } from './prayer-ordering';

/**
 * Property-Based Tests for Prayer Chronological Ordering
 * **Validates: Requirements 9.1**
 *
 * Property 6: Prayer Chronological Ordering
 * For any set of prayers returned by the prayer wall,
 * they shall be ordered in strictly descending createdAt timestamp —
 * each prayer's timestamp is greater than or equal to the next prayer's timestamp in the list.
 */

const prayerArb: fc.Arbitrary<PrayerWithTimestamp> = fc.record({
  id: fc.uuid(),
  createdAt: fc.date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2030-12-31T23:59:59.999Z'), noInvalidDate: true }),
});

describe('Property 6: Prayer Chronological Ordering', () => {
  it('prayers are in strictly descending createdAt order after sorting', () => {
    fc.assert(
      fc.property(
        fc.array(prayerArb, { minLength: 0, maxLength: 100 }),
        (prayers) => {
          const sorted = sortPrayersChronologically(prayers);

          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].createdAt.getTime()).toBeGreaterThanOrEqual(
              sorted[i + 1].createdAt.getTime()
            );
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('result has the same length as input (no items lost)', () => {
    fc.assert(
      fc.property(
        fc.array(prayerArb, { minLength: 0, maxLength: 100 }),
        (prayers) => {
          const sorted = sortPrayersChronologically(prayers);
          expect(sorted.length).toBe(prayers.length);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('result contains the same elements as input (no items added or replaced)', () => {
    fc.assert(
      fc.property(
        fc.array(prayerArb, { minLength: 1, maxLength: 50 }),
        (prayers) => {
          const sorted = sortPrayersChronologically(prayers);

          const inputIds = prayers.map(p => p.id).sort();
          const outputIds = sorted.map(p => p.id).sort();
          expect(outputIds).toEqual(inputIds);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('does not mutate the original array', () => {
    fc.assert(
      fc.property(
        fc.array(prayerArb, { minLength: 1, maxLength: 50 }),
        (prayers) => {
          const originalOrder = prayers.map(p => p.id);
          sortPrayersChronologically(prayers);
          const afterOrder = prayers.map(p => p.id);
          expect(afterOrder).toEqual(originalOrder);
        }
      ),
      { numRuns: 1000 }
    );
  });
});
