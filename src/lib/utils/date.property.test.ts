import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getRelativeTimestamp } from './date';

/**
 * Property 9: Relative Timestamp Correctness
 *
 * For any valid timestamp and reference "now" time, the relative timestamp formatter
 * SHALL produce a string that correctly represents the time difference in Indonesian locale.
 *
 * **Validates: Requirements 14.4**
 */
describe('Property 9: Relative Timestamp Correctness', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  it('timestamps 1-59 minutes in the past produce "X menit yang lalu"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 59 }),
        (minutes) => {
          const date = new Date(now.getTime() - minutes * 60 * 1000);
          const result = getRelativeTimestamp(date, now);
          expect(result).toContain('menit yang lalu');
          expect(result).toBe(`${minutes} menit yang lalu`);
        }
      )
    );
  });

  it('timestamps 1-23 hours in the past produce "X jam yang lalu"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 23 }),
        (hours) => {
          const date = new Date(now.getTime() - hours * 60 * 60 * 1000);
          const result = getRelativeTimestamp(date, now);
          expect(result).toContain('jam yang lalu');
          expect(result).toBe(`${hours} jam yang lalu`);
        }
      )
    );
  });

  it('timestamps 1-29 days in the past produce "X hari yang lalu"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 29 }),
        (days) => {
          const date = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
          const result = getRelativeTimestamp(date, now);
          expect(result).toContain('hari yang lalu');
          expect(result).toBe(`${days} hari yang lalu`);
        }
      )
    );
  });

  it('timestamps 1-59 minutes in the future produce "X menit lagi"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 59 }),
        (minutes) => {
          const date = new Date(now.getTime() + minutes * 60 * 1000);
          const result = getRelativeTimestamp(date, now);
          expect(result).toContain('menit lagi');
          expect(result).toBe(`${minutes} menit lagi`);
        }
      )
    );
  });

  it('timestamps 1-23 hours in the future produce "X jam lagi"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 23 }),
        (hours) => {
          const date = new Date(now.getTime() + hours * 60 * 60 * 1000);
          const result = getRelativeTimestamp(date, now);
          expect(result).toContain('jam lagi');
          expect(result).toBe(`${hours} jam lagi`);
        }
      )
    );
  });

  it('timestamps 1-29 days in the future produce "X hari lagi"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 29 }),
        (days) => {
          const date = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
          const result = getRelativeTimestamp(date, now);
          expect(result).toContain('hari lagi');
          expect(result).toBe(`${days} hari lagi`);
        }
      )
    );
  });

  it('the numeric value in the output matches the time delta', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 59 }),
        fc.boolean(),
        (minutes, isFuture) => {
          const date = isFuture
            ? new Date(now.getTime() + minutes * 60 * 1000)
            : new Date(now.getTime() - minutes * 60 * 1000);
          const result = getRelativeTimestamp(date, now);
          const numericMatch = result.match(/^(\d+)/);
          expect(numericMatch).not.toBeNull();
          expect(parseInt(numericMatch![1], 10)).toBe(minutes);
        }
      )
    );
  });
});
