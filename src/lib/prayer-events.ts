// Simple in-memory event emitter for SSE (production would use Redis pub/sub)
type PrayerListener = (prayer: unknown) => void;
const listeners: Set<PrayerListener> = new Set();

export function publishPrayer(prayer: unknown) {
  listeners.forEach((listener) => {
    listener(prayer);
  });
}

export function addListener(listener: PrayerListener) {
  listeners.add(listener);
}

export function removeListener(listener: PrayerListener) {
  listeners.delete(listener);
}
