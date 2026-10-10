import { describe, test, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { NextRequest } from "next/server";

// Feature: platform-polish, Property 7: Search Filter Intersection
// **Validates: Requirements 7.4**

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    // Public progress asks for the beta Gross to take back out of the counter
    // (counted-payment.ts); none is seeded here.
    payment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { prisma } from "@/lib/prisma";

const mockedPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Property 7: Search Filter Intersection
// Category filter combined with search query returns the intersection of both filters
// **Validates: Requirements 7.4**
// ============================================================
describe("Feature: platform-polish, Property 7: Search Filter Intersection", () => {
  // Arbitrary for non-empty search terms (alphanumeric to avoid regex issues)
  const searchTermArb = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => s.trim().length > 0)
    .map((s) => s.replace(/[^\w\s]/g, "a").trim())
    .filter((s) => s.length > 0);

  // Arbitrary for category slugs (lowercase alphanumeric + hyphens)
  const categorySlugArb = fc
    .stringMatching(/^[a-z][a-z0-9-]{1,20}$/)
    .filter((s) => s.length >= 2 && !s.endsWith("-"));

  test("when both search and category are provided, the where clause includes BOTH conditions", async () => {
    const { GET } = await import("@/app/api/campaigns/route");

    await fc.assert(
      fc.asyncProperty(
        searchTermArb,
        categorySlugArb,
        async (searchTerm, categorySlug) => {
          vi.clearAllMocks();

          // Mock prisma to return empty results (we only care about what WHERE clause is built)
          mockedPrisma.campaign.findMany.mockResolvedValue([]);
          mockedPrisma.campaign.count.mockResolvedValue(0);

          const url = new URL("http://localhost:3000/api/campaigns");
          url.searchParams.set("search", searchTerm);
          url.searchParams.set("category", categorySlug);

          const request = new NextRequest(url);
          const response = await GET(request);

          expect(response.status).toBe(200);

          // Verify the where clause passed to findMany includes BOTH filters
          const findManyCall = mockedPrisma.campaign.findMany.mock.calls[0][0];
          const where = findManyCall?.where as Record<string, unknown>;

          // Category filter must be present
          expect(where.category).toBe(categorySlug);

          // Search filter (OR condition) must also be present
          expect(where.OR).toBeDefined();
          expect(Array.isArray(where.OR)).toBe(true);

          const orConditions = where.OR as Array<Record<string, unknown>>;
          // At least one condition must search by title
          const hasTitle = orConditions.some(
            (cond) =>
              cond.title &&
              (cond.title as any).contains === searchTerm
          );
          expect(hasTitle).toBe(true);

          // The count query should also use the same where clause (both filters)
          const countCall = mockedPrisma.campaign.count.mock.calls[0][0];
          const countWhere = countCall?.where as Record<string, unknown>;
          expect(countWhere.category).toBe(categorySlug);
          expect(countWhere.OR).toBeDefined();
        }
      ),
      { numRuns: 50 }
    );
  });

  test("when only search is provided without category, the where clause does NOT include category", async () => {
    const { GET } = await import("@/app/api/campaigns/route");

    await fc.assert(
      fc.asyncProperty(searchTermArb, async (searchTerm) => {
        vi.clearAllMocks();

        mockedPrisma.campaign.findMany.mockResolvedValue([]);
        mockedPrisma.campaign.count.mockResolvedValue(0);

        const url = new URL("http://localhost:3000/api/campaigns");
        url.searchParams.set("search", searchTerm);

        const request = new NextRequest(url);
        const response = await GET(request);

        expect(response.status).toBe(200);

        const findManyCall = mockedPrisma.campaign.findMany.mock.calls[0][0];
        const where = findManyCall?.where as Record<string, unknown>;

        // Search filter must be present
        expect(where.OR).toBeDefined();

        // Category must NOT be in the where clause
        expect(where.category).toBeUndefined();
      }),
      { numRuns: 30 }
    );
  });

  test("when only category is provided without search, the where clause does NOT include OR (search)", async () => {
    const { GET } = await import("@/app/api/campaigns/route");

    await fc.assert(
      fc.asyncProperty(categorySlugArb, async (categorySlug) => {
        vi.clearAllMocks();

        mockedPrisma.campaign.findMany.mockResolvedValue([]);
        mockedPrisma.campaign.count.mockResolvedValue(0);

        const url = new URL("http://localhost:3000/api/campaigns");
        url.searchParams.set("category", categorySlug);

        const request = new NextRequest(url);
        const response = await GET(request);

        expect(response.status).toBe(200);

        const findManyCall = mockedPrisma.campaign.findMany.mock.calls[0][0];
        const where = findManyCall?.where as Record<string, unknown>;

        // Category filter must be present
        expect(where.category).toBe(categorySlug);

        // Search (OR) must NOT be in the where clause
        expect(where.OR).toBeUndefined();
      }),
      { numRuns: 30 }
    );
  });

  test("returned campaigns from intersection always satisfy both category and search text match", async () => {
    const { GET } = await import("@/app/api/campaigns/route");

    await fc.assert(
      fc.asyncProperty(
        searchTermArb,
        categorySlugArb,
        async (searchTerm, categorySlug) => {
          vi.clearAllMocks();

          // Mock campaigns that match both filters
          const matchingCampaigns = [
            {
              id: "camp-1",
              slug: "campaign-1",
              title: `Campaign about ${searchTerm}`,
              description: "Some description",
              category: categorySlug,
              collectedAmount: 100000,
              targetAmount: 500000,
              coverImage: "/img.jpg",
              isUrgent: false,
              deadline: null,
              createdAt: new Date(),
              creator: {
                name: "Creator",
              },
            },
          ];

          mockedPrisma.campaign.findMany.mockResolvedValue(
            matchingCampaigns as any
          );
          mockedPrisma.campaign.count.mockResolvedValue(1);

          const url = new URL("http://localhost:3000/api/campaigns");
          url.searchParams.set("search", searchTerm);
          url.searchParams.set("category", categorySlug);

          const request = new NextRequest(url);
          const response = await GET(request);

          expect(response.status).toBe(200);

          const body = await response.json();

          // All returned campaigns must match the category
          for (const campaign of body.campaigns) {
            expect(campaign.category).toBe(categorySlug);
          }

          // All returned campaigns must contain search term in title or description
          for (const campaign of body.campaigns) {
            const titleMatch = campaign.title
              .toLowerCase()
              .includes(searchTerm.toLowerCase());
            const descMatch = campaign.description
              ?.toLowerCase()
              .includes(searchTerm.toLowerCase());
            expect(titleMatch || descMatch).toBe(true);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
