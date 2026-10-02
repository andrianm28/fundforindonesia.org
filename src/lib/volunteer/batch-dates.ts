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
  return new Date(new Date(instant).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** The WIB offset (UTC+7, no daylight saving) in milliseconds. */
export const WIB_OFFSET_MS = 7 * 3600_000;

/** "6 Okt 2026": the WIB calendar date, whatever timezone the process runs in. */
export function formatWibDate(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  return `${wib.getUTCDate()} ${MONTHS[wib.getUTCMonth()]} ${wib.getUTCFullYear()}`;
}
