/**
 * Batch dates as the Fundraiser's form edits them: a plain calendar date in
 * Jakarta time (WIB, UTC+7, no daylight saving), turned into the ISO instant
 * the Batch API takes. Pure, so client code may import it. A Batch starts at
 * the start of its first day and ends, and closes registration, at the end of
 * its last.
 */

export type DateEdge = 'start' | 'end';

/** `2026-12-01` to the ISO instant of that day's first (or last) second in WIB. */
export function fromWibDate(value: string, edge: DateEdge): string {
  const time = edge === 'start' ? '00:00:00' : '23:59:59';
  return new Date(`${value}T${time}+07:00`).toISOString();
}

/** An instant to its WIB calendar date, `YYYY-MM-DD`. */
export function toWibDate(instant: Date | string): string {
  return new Date(new Date(instant).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}
