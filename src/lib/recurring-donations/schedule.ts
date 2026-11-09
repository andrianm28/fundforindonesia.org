/**
 * The calendar of a recurring donation (PKS pasal 4.7): which cycle is due
 * when. Pure, UTC, no clock of its own; the caller passes `now`.
 *
 * Cycle n is due `n * periodMonths` months after the start date, counted from
 * the START every time (never from the previous due date), so a 31st that was
 * clamped to 28 February is the 31st again in March. A month too short for the
 * day-of-month clamps to its last day.
 */

export type RecurringPeriod = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'YEARLY';

export const PERIOD_MONTHS: Record<RecurringPeriod, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  YEARLY: 12,
};

export const PERIOD_LABEL: Record<RecurringPeriod, string> = {
  MONTHLY: 'Bulanan',
  QUARTERLY: 'Tiap 3 bulan',
  SEMIANNUAL: 'Tiap 6 bulan',
  YEARLY: 'Tahunan',
};

/** The due date of cycle `index` (0 is the start date itself). */
export function cycleDueDate(startDate: Date, period: RecurringPeriod, index: number): Date {
  const months = PERIOD_MONTHS[period] * index;
  const target = new Date(
    Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth() + months,
      1,
      startDate.getUTCHours(),
      startDate.getUTCMinutes(),
      startDate.getUTCSeconds(),
      startDate.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(startDate.getUTCDate(), lastDay));
  return target;
}

/**
 * The latest cycle already due at `now`, or null before the start date. Only
 * the latest: a job that did not run for a while bills the cycle that is due
 * now, never a backlog of the cycles it missed.
 */
export function currentCycleIndex(startDate: Date, period: RecurringPeriod, now: Date): number | null {
  if (now.getTime() < startDate.getTime()) return null;
  // Start from an estimate by whole months elapsed, then correct: clamping makes
  // the exact boundary slightly irregular, so confirm with cycleDueDate itself.
  const monthsElapsed =
    (now.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - startDate.getUTCMonth());
  let index = Math.max(0, Math.floor(monthsElapsed / PERIOD_MONTHS[period]));
  while (cycleDueDate(startDate, period, index).getTime() > now.getTime()) index -= 1;
  while (cycleDueDate(startDate, period, index + 1).getTime() <= now.getTime()) index += 1;
  return index;
}
