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
  const day = date.getDate().toString().padStart(2, '0');
  const month = INDONESIAN_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
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
