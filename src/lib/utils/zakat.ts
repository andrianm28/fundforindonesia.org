/**
 * Zakat calculation utilities.
 * Zakat is 2.5% of assets above the nisab threshold.
 */

/**
 * Calculates Zakat Mal (wealth zakat).
 * Returns 2.5% of (assets - nisab) when assets exceed nisab, 0 otherwise.
 * Result is always a non-negative integer (rounded to nearest Rupiah).
 *
 * @param assets - Total asset value in Rupiah
 * @param nisab - Nisab threshold in Rupiah
 * @returns Zakat amount as a non-negative integer
 */
export function calculateZakat(assets: number, nisab: number): number {
  if (assets <= nisab) return 0;
  const zakat = (assets - nisab) * 0.025;
  return Math.round(zakat);
}

/**
 * Calculates Zakat Fitrah.
 * Based on 3.5 kg of staple food per person.
 *
 * @param pricePerKg - Price per kilogram of staple food (e.g., rice) in Rupiah
 * @param people - Number of people (default: 1)
 * @returns Zakat Fitrah amount as a non-negative integer
 */
export function calculateZakatFitrah(pricePerKg: number, people: number = 1): number {
  if (pricePerKg <= 0 || people <= 0) return 0;
  const amount = 3.5 * pricePerKg * people;
  return Math.round(amount);
}
