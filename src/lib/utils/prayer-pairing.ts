export interface PrayerPair {
  prayerId: string;
  donationId: string;
}

/**
 * Validates that prayer-donation pairing is unique:
 * - Each prayer references exactly one donation (unique donationId per prayer)
 * - Each donation has at most one prayer (no duplicate donationIds across prayers)
 */
export function validatePrayerPairing(pairs: PrayerPair[]): { valid: boolean; duplicates: string[] } {
  const seenDonationIds = new Set<string>();
  const duplicates: string[] = [];

  for (const pair of pairs) {
    if (seenDonationIds.has(pair.donationId)) {
      duplicates.push(pair.donationId);
    }
    seenDonationIds.add(pair.donationId);
  }

  return { valid: duplicates.length === 0, duplicates };
}
