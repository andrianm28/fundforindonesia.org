/**
 * Indonesian date formatting and relative timestamp utilities.
 */

const INDONESIAN_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

/**
 * Formats a Date to Indonesian short date format.
 * @example formatIndonesianDate(new Date('2026-06-06')) → "06 Jun 2026"
 */
export function formatIndonesianDate(date: Date): string {
  // WIB calendar day whatever timezone the process runs in (audit FE-03):
  // server and browser must print the same date on a document of record.
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const day = wib.getUTCDate().toString().padStart(2, '0');
  return `${day} ${INDONESIAN_MONTHS[wib.getUTCMonth()]} ${wib.getUTCFullYear()}`;
}

/** The WIB offset (UTC+7, no daylight saving) in milliseconds. */
const WIB_OFFSET_MS = 7 * 3600_000;

const LONG_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * "31 Desember 2026" for a `YYYY-MM-DD` calendar date (as an <input type=date>
 * gives) or an instant read in WIB.
 */
export function formatWibLongDate(value: Date | string): string {
  const [y, m, d] =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value.split('-').map(Number)
      : (() => {
          const wib = new Date(new Date(value).getTime() + WIB_OFFSET_MS);
          return [wib.getUTCFullYear(), wib.getUTCMonth() + 1, wib.getUTCDate()];
        })();
  return `${d} ${LONG_MONTHS[m - 1]} ${y}`;
}

/** Today's WIB calendar date, `YYYY-MM-DD`. */
export function todayWibDate(now: Date = new Date()): string {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The instant a Campaign deadline picked as the calendar date `YYYY-MM-DD`
 * ends: 23:59:59.999 Asia/Jakarta on that date (audit FE-02). Campaigns used
 * to store the date as UTC midnight, which ended them at 07:00 WIB.
 */
export function endOfWibDay(date: string): Date {
  return new Date(`${date}T23:59:59.999+07:00`);
}

/**
 * Returns a relative timestamp string in Indonesian.
 * Past: "baru saja", "X menit yang lalu", "X jam yang lalu", "X hari yang lalu"
 * Future: "X menit lagi", "X jam lagi", "X hari lagi"
 */
export function getRelativeTimestamp(date: Date, now?: Date): string {
  const reference = now ?? new Date();
  const diffMs = reference.getTime() - date.getTime();
  const absDiffMs = Math.abs(diffMs);
  const isFuture = diffMs < 0;

  const seconds = Math.floor(absDiffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) {
    return isFuture ? 'sebentar lagi' : 'baru saja';
  }

  if (minutes < 60) {
    return isFuture ? `${minutes} menit lagi` : `${minutes} menit yang lalu`;
  }

  if (hours < 24) {
    return isFuture ? `${hours} jam lagi` : `${hours} jam yang lalu`;
  }

  if (days < 30) {
    return isFuture ? `${days} hari lagi` : `${days} hari yang lalu`;
  }

  if (months < 12) {
    return isFuture ? `${months} bulan lagi` : `${months} bulan yang lalu`;
  }

  return isFuture ? `${years} tahun lagi` : `${years} tahun yang lalu`;
}

/**
 * Returns the number of days remaining until a deadline.
 * Returns null if no deadline is provided.
 * Returns 0 if the deadline has passed.
 */
export function getRemainingDays(deadline: Date | null, now?: Date): number | null {
  if (!deadline) return null;
  const reference = now ?? new Date();
  const diffMs = deadline.getTime() - reference.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
