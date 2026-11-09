import { describe, expect, it } from 'vitest';
import { currentCycleIndex, cycleDueDate, PERIOD_MONTHS } from './schedule';

const START = new Date('2026-11-15T00:00:00.000Z');

describe('cycleDueDate', () => {
  it('counts whole periods from the start date', () => {
    expect(cycleDueDate(START, 'MONTHLY', 0).toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(cycleDueDate(START, 'MONTHLY', 2).toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(cycleDueDate(START, 'QUARTERLY', 1).toISOString()).toBe('2027-02-15T00:00:00.000Z');
    expect(cycleDueDate(START, 'SEMIANNUAL', 1).toISOString()).toBe('2027-05-15T00:00:00.000Z');
    expect(cycleDueDate(START, 'YEARLY', 1).toISOString()).toBe('2027-11-15T00:00:00.000Z');
  });

  it('clamps to the last day of a shorter month and does not drift afterwards', () => {
    const jan31 = new Date('2027-01-31T00:00:00.000Z');
    expect(cycleDueDate(jan31, 'MONTHLY', 1).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    // Counted from the start, not from the clamped February date.
    expect(cycleDueDate(jan31, 'MONTHLY', 2).toISOString()).toBe('2027-03-31T00:00:00.000Z');
    expect(cycleDueDate(new Date('2028-02-29T00:00:00.000Z'), 'YEARLY', 1).toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });

  it('names a month count for every period', () => {
    expect(PERIOD_MONTHS).toEqual({ MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, YEARLY: 12 });
  });
});

describe('currentCycleIndex', () => {
  it('is null before the start date', () => {
    expect(currentCycleIndex(START, 'MONTHLY', new Date('2026-11-14T23:59:59.999Z'))).toBeNull();
  });

  it('is the latest cycle already due, so a missed run never bills a backlog', () => {
    expect(currentCycleIndex(START, 'MONTHLY', START)).toBe(0);
    expect(currentCycleIndex(START, 'MONTHLY', new Date('2026-12-14T23:59:59.000Z'))).toBe(0);
    expect(currentCycleIndex(START, 'MONTHLY', new Date('2026-12-15T00:00:00.000Z'))).toBe(1);
    expect(currentCycleIndex(START, 'MONTHLY', new Date('2027-06-20T00:00:00.000Z'))).toBe(7);
    expect(currentCycleIndex(START, 'YEARLY', new Date('2028-11-15T00:00:00.000Z'))).toBe(2);
  });
});
