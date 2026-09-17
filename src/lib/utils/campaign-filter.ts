/**
 * Filters campaigns by category.
 * Returns only campaigns whose category field exactly matches the given category string.
 */
export function filterByCategory<T extends { category: string }>(
  campaigns: T[],
  category: string
): T[] {
  return campaigns.filter((c) => c.category === category);
}
