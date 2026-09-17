/**
 * Indonesian Rupiah currency formatting utilities.
 * Uses period (.) as thousands separator, no decimals.
 */

/**
 * Formats a number to Indonesian Rupiah string.
 * @example formatRupiah(25841000) → "Rp25.841.000"
 * @example formatRupiah(0) → "Rp0"
 * @example formatRupiah(-50000) → "-Rp50.000"
 */
export function formatRupiah(amount: number): string {
  const isNegative = amount < 0;
  const absoluteAmount = Math.abs(amount);
  const formatted = absoluteAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${isNegative ? '-' : ''}Rp${formatted}`;
}

/**
 * Parses an Indonesian Rupiah formatted string back to a number.
 * Strips "Rp" prefix and period separators.
 * @example parseRupiah("Rp25.841.000") → 25841000
 * @example parseRupiah("Rp0") → 0
 * @example parseRupiah("-Rp50.000") → -50000
 */
export function parseRupiah(formatted: string): number {
  const isNegative = formatted.startsWith('-');
  const cleaned = formatted.replace(/^-?Rp/, '').replace(/\./g, '');
  const value = parseInt(cleaned, 10);
  if (isNaN(value)) return 0;
  return isNegative ? -value : value;
}
