export interface PrayerWithTimestamp {
  id: string;
  createdAt: Date;
}

export function sortPrayersChronologically(prayers: PrayerWithTimestamp[]): PrayerWithTimestamp[] {
  return [...prayers].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
