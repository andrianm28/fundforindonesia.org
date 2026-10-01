import { describe, it, expect } from 'vitest';
import { fromWibDate, toWibDate } from './batch-dates';

describe('batch dates in WIB', () => {
  it('starts a Batch at the first second of its day in Jakarta time', () => {
    expect(fromWibDate('2026-12-01', 'start')).toBe('2026-11-30T17:00:00.000Z');
  });

  it('ends a Batch, and closes registration, at the last second of the day', () => {
    expect(fromWibDate('2026-12-05', 'end')).toBe('2026-12-05T16:59:59.000Z');
  });

  it('reads an instant back as its WIB calendar date, across the UTC midnight', () => {
    expect(toWibDate(new Date('2026-11-30T17:00:00.000Z'))).toBe('2026-12-01');
    expect(toWibDate('2026-12-05T16:59:59.000Z')).toBe('2026-12-05');
  });

  it('round-trips a date through both edges', () => {
    expect(toWibDate(fromWibDate('2026-12-31', 'start'))).toBe('2026-12-31');
    expect(toWibDate(fromWibDate('2026-12-31', 'end'))).toBe('2026-12-31');
  });
});
