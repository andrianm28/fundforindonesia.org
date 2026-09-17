import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { searchCampaigns, SearchableCampaign } from './campaign-search';

/**
 * Property-based tests for Search Result Relevance (Property 8)
 *
 * **Validates: Requirements 13.2**
 *
 * Property 8: Search Result Relevance
 * For any search query string and campaign dataset, all Campaigns returned by the
 * search function SHALL contain the query string (case-insensitive) in either their
 * title or description field.
 */

// Arbitrary that generates a non-empty string suitable for campaign fields
const campaignStringArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

// Arbitrary that generates a SearchableCampaign
const campaignArb: fc.Arbitrary<SearchableCampaign> = fc.record({
  title: campaignStringArb,
  description: campaignStringArb,
});

describe('Property 8: Search Result Relevance', () => {
  it('all returned campaigns contain the query string (case-insensitive) in title or description', () => {
    fc.assert(
      fc.property(
        fc.array(campaignArb, { minLength: 1, maxLength: 20 }),
        (campaigns) => {
          // Pick a random campaign and extract a substring from its title or description
          const targetCampaign = campaigns[0];
          const source = targetCampaign.title.length > 0 ? targetCampaign.title : targetCampaign.description;

          if (source.length === 0) return; // Skip if empty

          // Take a substring of length 1 to source.length as query
          const startIdx = 0;
          const endIdx = Math.max(1, Math.floor(source.length / 2));
          const query = source.slice(startIdx, endIdx);

          if (query.length === 0) return; // Skip empty queries

          const results = searchCampaigns(campaigns, query);
          const lowerQuery = query.toLowerCase();

          // Verify: ALL returned campaigns contain query in title or description
          for (const campaign of results) {
            const matchesTitle = campaign.title.toLowerCase().includes(lowerQuery);
            const matchesDescription = campaign.description.toLowerCase().includes(lowerQuery);
            expect(matchesTitle || matchesDescription).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('no campaigns that match the query are missing from results (zero false exclusions)', () => {
    fc.assert(
      fc.property(
        fc.array(campaignArb, { minLength: 1, maxLength: 20 }),
        (campaigns) => {
          const targetCampaign = campaigns[0];
          const source = targetCampaign.title.length > 0 ? targetCampaign.title : targetCampaign.description;

          if (source.length === 0) return;

          const startIdx = 0;
          const endIdx = Math.max(1, Math.floor(source.length / 2));
          const query = source.slice(startIdx, endIdx);

          if (query.length === 0) return;

          const results = searchCampaigns(campaigns, query);
          const lowerQuery = query.toLowerCase();

          // Verify: every campaign in the original array that matches is included in results
          for (const campaign of campaigns) {
            const matchesTitle = campaign.title.toLowerCase().includes(lowerQuery);
            const matchesDescription = campaign.description.toLowerCase().includes(lowerQuery);

            if (matchesTitle || matchesDescription) {
              expect(results).toContain(campaign);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('search is case-insensitive: query in any case returns the same results', () => {
    fc.assert(
      fc.property(
        fc.array(campaignArb, { minLength: 1, maxLength: 20 }),
        fc.constantFrom('upper', 'lower', 'mixed') as fc.Arbitrary<string>,
        (campaigns, caseType) => {
          const targetCampaign = campaigns[0];
          const source = targetCampaign.title.length > 0 ? targetCampaign.title : targetCampaign.description;

          if (source.length === 0) return;

          const baseQuery = source.slice(0, Math.max(1, Math.floor(source.length / 2)));
          if (baseQuery.length === 0) return;

          let query: string;
          switch (caseType) {
            case 'upper':
              query = baseQuery.toUpperCase();
              break;
            case 'lower':
              query = baseQuery.toLowerCase();
              break;
            default:
              query = baseQuery;
              break;
          }

          const resultsOriginal = searchCampaigns(campaigns, baseQuery);
          const resultsCased = searchCampaigns(campaigns, query);

          // Both should return the same set of campaigns
          expect(resultsCased.length).toBe(resultsOriginal.length);
          for (const campaign of resultsCased) {
            expect(resultsOriginal).toContain(campaign);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('query derived from campaign title/description always includes that campaign in results', () => {
    fc.assert(
      fc.property(
        fc.array(campaignArb, { minLength: 1, maxLength: 20 }),
        fc.nat({ max: 19 }),
        (campaigns, indexSeed) => {
          const idx = indexSeed % campaigns.length;
          const targetCampaign = campaigns[idx];

          // Extract substring from title
          const title = targetCampaign.title;
          if (title.length === 0) return;

          const substringLength = Math.max(1, Math.floor(title.length / 2));
          const query = title.slice(0, substringLength);

          if (query.length === 0) return;

          const results = searchCampaigns(campaigns, query);

          // The target campaign MUST be in the results
          expect(results).toContain(targetCampaign);
        }
      ),
      { numRuns: 200 }
    );
  });
});
