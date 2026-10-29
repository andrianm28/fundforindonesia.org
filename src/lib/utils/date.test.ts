import { describe, it, expect } from 'vitest';
import { formatIndonesianDate, endOfWibDay, todayWibDate, formatWibLongDate, getRelativeTimestamp, getRemainingDays } from './date';

describe('formatIndonesianDate', () => {
  it('formats date correctly', () => {
    expect(formatIndonesianDate(new Date('2026-06-06'))).toBe('06 Jun 2026');
  });

  it('formats January correctly', () => {
    expect(formatIndonesianDate(new Date('2024-01-15'))).toBe('15 Jan 2024');
  });

  it('formats December correctly', () => {
    expect(formatIndonesianDate(new Date('2024-12-31'))).toBe('31 Des 2024');
  });

  it('pads single-digit days', () => {
    expect(formatIndonesianDate(new Date('2024-03-01'))).toBe('01 Mar 2024');
  });
});

describe('WIB calendar (FE-02, FE-03)', () => {
  it('formatIndonesianDate shows the WIB day, not the process day', () => {
    // 19:00Z on the 16th is 02:00 WIB on the 17th.
    expect(formatIndonesianDate(new Date('2026-10-16T19:00:00Z'))).toBe('17 Okt 2026');
    expect(formatIndonesianDate(new Date('2026-10-16T16:59:59Z'))).toBe('16 Okt 2026');
  });

  it('endOfWibDay is 23:59:59.999 WIB on the chosen date', () => {
    expect(endOfWibDay('2026-12-31').toISOString()).toBe('2026-12-31T16:59:59.999Z');
    expect(endOfWibDay('2026-03-01').toISOString()).toBe('2026-03-01T16:59:59.999Z');
  });

  it('todayWibDate rolls over at 17:00Z', () => {
    expect(todayWibDate(new Date('2026-10-16T16:59:00Z'))).toBe('2026-10-16');
    expect(todayWibDate(new Date('2026-10-16T17:00:00Z'))).toBe('2026-10-17');
  });

  it('formatWibLongDate names the month in full, in WIB', () => {
    expect(formatWibLongDate('2026-12-31')).toBe('31 Desember 2026');
    expect(formatWibLongDate(new Date('2026-12-31T16:59:59.999Z'))).toBe('31 Desember 2026');
    expect(formatWibLongDate(new Date('2026-12-31T17:00:00Z'))).toBe('1 Januari 2027');
  });
});

describe('getRelativeTimestamp', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  it('returns "baru saja" for less than 1 minute ago', () => {
    const date = new Date('2024-06-15T11:59:30Z');
    expect(getRelativeTimestamp(date, now)).toBe('baru saja');
  });

  it('returns minutes ago', () => {
    const date = new Date('2024-06-15T11:55:00Z');
    expect(getRelativeTimestamp(date, now)).toBe('5 menit yang lalu');
  });

  it('returns hours ago', () => {
    const date = new Date('2024-06-15T09:00:00Z');
    expect(getRelativeTimestamp(date, now)).toBe('3 jam yang lalu');
  });

  it('returns days ago', () => {
    const date = new Date('2024-06-12T12:00:00Z');
    expect(getRelativeTimestamp(date, now)).toBe('3 hari yang lalu');
  });

  it('returns months ago', () => {
    const date = new Date('2024-04-15T12:00:00Z');
    expect(getRelativeTimestamp(date, now)).toBe('2 bulan yang lalu');
  });

  it('returns years ago', () => {
    const date = new Date('2022-06-15T12:00:00Z');
    expect(getRelativeTimestamp(date, now)).toBe('2 tahun yang lalu');
  });

  // Future timestamps
  it('returns "sebentar lagi" for less than 1 minute in future', () => {
    const date = new Date('2024-06-15T12:00:30Z');
    expect(getRelativeTimestamp(date, now)).toBe('sebentar lagi');
  });

  it('returns minutes in future', () => {
    const date = new Date('2024-06-15T12:05:00Z');
    expect(getRelativeTimestamp(date, now)).toBe('5 menit lagi');
  });

  it('returns hours in future', () => {
    const date = new Date('2024-06-15T15:00:00Z');
    expect(getRelativeTimestamp(date, now)).toBe('3 jam lagi');
  });

  it('returns days in future', () => {
    const date = new Date('2024-06-18T12:00:00Z');
    expect(getRelativeTimestamp(date, now)).toBe('3 hari lagi');
  });
});

describe('getRemainingDays', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  it('returns null when no deadline', () => {
    expect(getRemainingDays(null, now)).toBeNull();
  });

  it('returns 0 when deadline has passed', () => {
    const deadline = new Date('2024-06-14T00:00:00Z');
    expect(getRemainingDays(deadline, now)).toBe(0);
  });

  it('returns remaining days', () => {
    const deadline = new Date('2024-06-20T12:00:00Z');
    expect(getRemainingDays(deadline, now)).toBe(5);
  });

  it('rounds up partial days', () => {
    const deadline = new Date('2024-06-16T00:00:00Z');
    expect(getRemainingDays(deadline, now)).toBe(1);
  });
});
