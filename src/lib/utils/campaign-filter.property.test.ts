import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { filterByCategory } from './campaign-filter';

/**
 * Property 4: Category Filter Correctness
 *
 * For any set of Campaigns and any selected Category, filtering by that Category
 * SHALL return only Campaigns whose category field matches the selected Category —
 * with zero false inclusions and zero false exclusions.
 *
 * **Validates: Requirements 5.2**
 */
describe('Property 4: Category Filter Correctness', () => {
  const categories = ['bencana-alam', 'kesehatan', 'pendidikan', 'anak', 'lingkungan'];

  const campaignArb = fc.record({
    id: fc.uuid(),
    title: fc.string({ minLength: 1, maxLength: 100 }),
    category: fc.constantFrom(...categories),
  });

  const campaignsArb = fc.array(campaignArb, { minLength: 0, maxLength: 50 });
  const categoryArb = fc.constantFrom(...categories);

  it('should return only campaigns matching the selected category (zero false inclusions)', () => {
    fc.assert(
      fc.property(campaignsArb, categoryArb, (campaigns, selectedCategory) => {
        const result = filterByCategory(campaigns, selectedCategory);

        // Every item in the result must match the selected category
        for (const campaign of result) {
          expect(campaign.category).toBe(selectedCategory);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('should include all campaigns matching the selected category (zero false exclusions)', () => {
    fc.assert(
      fc.property(campaignsArb, categoryArb, (campaigns, selectedCategory) => {
        const result = filterByCategory(campaigns, selectedCategory);

        // Count how many campaigns in the original array match the category
        const expectedMatches = campaigns.filter(
          (c) => c.category === selectedCategory
        );

        // The result must contain exactly as many items as there are matches
        expect(result.length).toBe(expectedMatches.length);
      }),
      { numRuns: 200 }
    );
  });

  it('should have zero false inclusions AND zero false exclusions simultaneously', () => {
    fc.assert(
      fc.property(campaignsArb, categoryArb, (campaigns, selectedCategory) => {
        const result = filterByCategory(campaigns, selectedCategory);

        // Zero false inclusions: all returned items match the category
        const allMatch = result.every((c) => c.category === selectedCategory);
        expect(allMatch).toBe(true);

        // Zero false exclusions: no matching items are missing from the result
        const allIncluded = campaigns
          .filter((c) => c.category === selectedCategory)
          .every((c) => result.includes(c));
        expect(allIncluded).toBe(true);

        // Result length equals the count of matching campaigns
        const expectedCount = campaigns.filter(
          (c) => c.category === selectedCategory
        ).length;
        expect(result.length).toBe(expectedCount);
      }),
      { numRuns: 200 }
    );
  });
});
