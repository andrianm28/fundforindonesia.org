import { describe, expect, it } from 'vitest';
import { exceedsMaxDuration, latestAllowedDeadline } from './campaign-kind';

const FROM = new Date('2026-10-30T10:00:00Z');

describe('the 12 month limit on a deadline (C12, 2026-10-04)', () => {
  it('allows a deadline of exactly 12 months', () => {
    expect(latestAllowedDeadline(FROM).toISOString()).toBe('2027-10-30T10:00:00.000Z');
    expect(exceedsMaxDuration({ kind: 'DONATION', deadline: new Date('2027-10-30T10:00:00Z') }, FROM)).toBe(false);
  });

  it('refuses a deadline one second past 12 months', () => {
    expect(exceedsMaxDuration({ kind: 'DONATION', deadline: new Date('2027-10-30T10:00:01Z') }, FROM)).toBe(true);
    expect(exceedsMaxDuration({ kind: 'HIBAH', deadline: '2028-01-01T00:00:00Z' }, FROM)).toBe(true);
  });

  it('exempts wakaf, however far its deadline', () => {
    expect(exceedsMaxDuration({ kind: 'WAKAF', deadline: new Date('2040-01-01T00:00:00Z') }, FROM)).toBe(false);
  });

  it('leaves a missing deadline to the deadline-required rule', () => {
    expect(exceedsMaxDuration({ kind: 'DONATION', deadline: null }, FROM)).toBe(false);
  });

  it('clamps a 29 February start to the end of February', () => {
    expect(latestAllowedDeadline(new Date('2028-02-29T00:00:00Z')).toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });
});
