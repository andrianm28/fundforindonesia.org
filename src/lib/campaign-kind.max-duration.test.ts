import { describe, expect, it } from 'vitest';
import { exceedsMaxDuration, latestAllowedDeadline } from './campaign-kind';

const FROM = new Date('2026-10-30T10:00:00Z'); // 17:00 WIB

describe('the 12 month limit on a deadline (C12, 2026-10-04), by WIB calendar date', () => {
  it('allows any time on the same WIB date 12 months on', () => {
    expect(latestAllowedDeadline(FROM).toISOString()).toBe('2027-10-30T16:59:59.999Z');
    expect(exceedsMaxDuration({ kind: 'DONATION', deadline: new Date('2027-10-30T16:59:00Z') }, FROM)).toBe(false);
  });

  it('refuses the next WIB date', () => {
    expect(exceedsMaxDuration({ kind: 'DONATION', deadline: new Date('2027-10-30T17:00:00Z') }, FROM)).toBe(true);
    expect(exceedsMaxDuration({ kind: 'HIBAH', deadline: '2028-01-01T00:00:00Z' }, FROM)).toBe(true);
  });

  it('reads the WIB date, not the UTC one, of a start just after 17:00Z', () => {
    // 18:00Z on 30 Oct is already 31 Oct in WIB.
    expect(latestAllowedDeadline(new Date('2026-10-30T18:00:00Z')).toISOString()).toBe('2027-10-31T16:59:59.999Z');
  });

  it('exempts wakaf, however far its deadline', () => {
    expect(exceedsMaxDuration({ kind: 'WAKAF', deadline: new Date('2040-01-01T00:00:00Z') }, FROM)).toBe(false);
  });

  it('leaves a missing deadline to the deadline-required rule', () => {
    expect(exceedsMaxDuration({ kind: 'DONATION', deadline: null }, FROM)).toBe(false);
  });

  it.each([
    ['2028-02-29T03:00:00Z', '2029-02-28T16:59:59.999Z'],
    ['2027-01-31T03:00:00Z', '2028-01-31T16:59:59.999Z'],
    ['2026-05-31T03:00:00Z', '2027-05-31T16:59:59.999Z'],
    ['2026-01-29T03:00:00Z', '2027-01-29T16:59:59.999Z'],
    ['2026-01-30T03:00:00Z', '2027-01-30T16:59:59.999Z'],
    ['2026-01-31T03:00:00Z', '2027-01-31T16:59:59.999Z'],
    ['2023-02-28T03:00:00Z', '2024-02-28T16:59:59.999Z'],
    ['2024-02-29T03:00:00Z', '2025-02-28T16:59:59.999Z'],
  ])('starting %s the latest deadline is %s', (start, latest) => {
    expect(latestAllowedDeadline(new Date(start)).toISOString()).toBe(latest);
  });
});
