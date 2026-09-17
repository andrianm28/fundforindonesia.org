import { describe, test, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { Role } from "@/generated/prisma/client";
import { NextRequest } from "next/server";

// Feature: user-roles, Property 12: Campaign Creator Ownership Enforcement
// **Validates: Requirements 5.5, 10.4**

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { PATCH, DELETE } from "@/app/api/campaigns/[slug]/route";

const mockFindUnique = vi.mocked(prisma.campaign.findUnique);
const mockUpdate = vi.mocked(prisma.campaign.update);
const mockDelete = vi.mocked(prisma.campaign.delete);
const mockGetServerSession = vi.mocked(getServerSession);

// Valid roles
const VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

// Arbitrary that generates valid user IDs (cuid-like strings)
const userIdArb = fc.string({ minLength: 10, maxLength: 25 }).filter(
  (s) => s.length > 0 && /^[a-zA-Z0-9]+$/.test(s)
);

// Arbitrary that generates campaign slugs
const slugArb = fc.string({ minLength: 3, maxLength: 30 }).filter(
  (s) => s.length > 0 && /^[a-z0-9-]+$/.test(s)
);

// Arbitrary for roles
const roleArb = fc.constantFrom<Role>(...VALID_ROLES);

// Helper to create a mock session
function mockSession(userId: string, role: Role) {
  return {
    user: {
      id: userId,
      name: "Test User",
      email: "test@example.com",
      role,
      isVerified: true,
      verificationType: null,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

// Helper to create a mock campaign
function mockCampaign(creatorId: string) {
  return {
    id: "campaign-id-123",
    creatorId,
  };
}

// Helper to create a PATCH request
function createPatchRequest(slug: string) {
  return new NextRequest(
    `http://localhost:3000/api/campaigns/${slug}`,
    {
      method: "PATCH",
      body: JSON.stringify({ title: "Updated Title" }),
      headers: { "Content-Type": "application/json" },
    }
  );
}

// Helper to create a DELETE request
function createDeleteRequest(slug: string) {
  return new NextRequest(
    `http://localhost:3000/api/campaigns/${slug}`,
    { method: "DELETE" }
  );
}

// Helper to create params context (matching Next.js App Router pattern)
function createParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: update and delete succeed
  mockUpdate.mockResolvedValue({
    id: "campaign-id-123",
    slug: "test-campaign",
    title: "Updated Title",
    creator: { id: "creator-id", name: "Creator", avatar: null, isVerified: true, verificationType: null },
  } as any);
  mockDelete.mockResolvedValue({ id: "campaign-id-123" } as any);
});

describe("Feature: user-roles, Property 12: Campaign Creator Ownership Enforcement", () => {
  describe("ADMIN always allowed to edit/delete regardless of ownership", () => {
    test("ADMIN can always PATCH any campaign, even when not the owner", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          userIdArb,
          slugArb,
          async (adminId, creatorId, slug) => {
            // Ensure admin is NOT the creator to test non-owner admin access
            fc.pre(adminId !== creatorId);

            mockGetServerSession.mockResolvedValue(mockSession(adminId, "ADMIN"));
            mockFindUnique.mockResolvedValue(mockCampaign(creatorId) as any);

            const req = createPatchRequest(slug);
            const response = await PATCH(req, createParams(slug) as any);

            expect(response.status).toBe(200);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("ADMIN can always DELETE any campaign, even when not the owner", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          userIdArb,
          slugArb,
          async (adminId, creatorId, slug) => {
            fc.pre(adminId !== creatorId);

            mockGetServerSession.mockResolvedValue(mockSession(adminId, "ADMIN"));
            mockFindUnique.mockResolvedValue(mockCampaign(creatorId) as any);

            const req = createDeleteRequest(slug);
            const response = await DELETE(req, createParams(slug) as any);

            expect(response.status).toBe(200);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("CAMPAIGN_CREATOR who IS the owner can edit/delete", () => {
    test("Owner CAMPAIGN_CREATOR can PATCH their own campaign", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          slugArb,
          async (userId, slug) => {
            // User is both the session user AND the campaign creator
            mockGetServerSession.mockResolvedValue(
              mockSession(userId, "CAMPAIGN_CREATOR")
            );
            mockFindUnique.mockResolvedValue(mockCampaign(userId) as any);

            const req = createPatchRequest(slug);
            const response = await PATCH(req, createParams(slug) as any);

            expect(response.status).toBe(200);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("Owner CAMPAIGN_CREATOR can DELETE their own campaign", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          slugArb,
          async (userId, slug) => {
            mockGetServerSession.mockResolvedValue(
              mockSession(userId, "CAMPAIGN_CREATOR")
            );
            mockFindUnique.mockResolvedValue(mockCampaign(userId) as any);

            const req = createDeleteRequest(slug);
            const response = await DELETE(req, createParams(slug) as any);

            expect(response.status).toBe(200);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("CAMPAIGN_CREATOR who is NOT the owner gets 403", () => {
    test("Non-owner CAMPAIGN_CREATOR is denied PATCH", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          userIdArb,
          slugArb,
          async (userId, creatorId, slug) => {
            // Ensure the user is NOT the owner
            fc.pre(userId !== creatorId);

            mockGetServerSession.mockResolvedValue(
              mockSession(userId, "CAMPAIGN_CREATOR")
            );
            mockFindUnique.mockResolvedValue(mockCampaign(creatorId) as any);

            const req = createPatchRequest(slug);
            const response = await PATCH(req, createParams(slug) as any);

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body.error).toBe("Forbidden");
          }
        ),
        { numRuns: 100 }
      );
    });

    test("Non-owner CAMPAIGN_CREATOR is denied DELETE", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          userIdArb,
          slugArb,
          async (userId, creatorId, slug) => {
            fc.pre(userId !== creatorId);

            mockGetServerSession.mockResolvedValue(
              mockSession(userId, "CAMPAIGN_CREATOR")
            );
            mockFindUnique.mockResolvedValue(mockCampaign(creatorId) as any);

            const req = createDeleteRequest(slug);
            const response = await DELETE(req, createParams(slug) as any);

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body.error).toBe("Forbidden");
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("DONOR always gets 403 regardless of ownership", () => {
    test("DONOR is denied PATCH even if they are the creator (edge case)", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          slugArb,
          async (userId, slug) => {
            // DONOR who happens to be campaign creator (shouldn't normally happen)
            mockGetServerSession.mockResolvedValue(
              mockSession(userId, "DONOR")
            );
            mockFindUnique.mockResolvedValue(mockCampaign(userId) as any);

            const req = createPatchRequest(slug);
            const response = await PATCH(req, createParams(slug) as any);

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body.error).toBe("Forbidden");
          }
        ),
        { numRuns: 100 }
      );
    });

    test("DONOR is denied DELETE even if they are the creator (edge case)", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          slugArb,
          async (userId, slug) => {
            mockGetServerSession.mockResolvedValue(
              mockSession(userId, "DONOR")
            );
            mockFindUnique.mockResolvedValue(mockCampaign(userId) as any);

            const req = createDeleteRequest(slug);
            const response = await DELETE(req, createParams(slug) as any);

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body.error).toBe("Forbidden");
          }
        ),
        { numRuns: 100 }
      );
    });

    test("DONOR is denied PATCH when not the owner", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          userIdArb,
          slugArb,
          async (userId, creatorId, slug) => {
            fc.pre(userId !== creatorId);

            mockGetServerSession.mockResolvedValue(
              mockSession(userId, "DONOR")
            );
            mockFindUnique.mockResolvedValue(mockCampaign(creatorId) as any);

            const req = createPatchRequest(slug);
            const response = await PATCH(req, createParams(slug) as any);

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body.error).toBe("Forbidden");
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Comprehensive ownership enforcement property", () => {
    test("For any user/campaign combo: access is determined by (role >= CAMPAIGN_CREATOR AND is owner) OR role === ADMIN", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          userIdArb,
          roleArb,
          slugArb,
          fc.constantFrom("PATCH", "DELETE"),
          async (userId, creatorId, role, slug, method) => {
            mockGetServerSession.mockResolvedValue(mockSession(userId, role));
            mockFindUnique.mockResolvedValue(mockCampaign(creatorId) as any);

            const req =
              method === "PATCH"
                ? createPatchRequest(slug)
                : createDeleteRequest(slug);

            const handler = method === "PATCH" ? PATCH : DELETE;
            const response = await handler(req, createParams(slug) as any);

            const isAdmin = role === "ADMIN";
            const isOwnerWithSufficientRole =
              role === "CAMPAIGN_CREATOR" && userId === creatorId;
            // MODERATOR who is owner also has isAtLeast("CAMPAIGN_CREATOR") = true
            const isModeratorOwner =
              role === "MODERATOR" && userId === creatorId;

            const shouldAllow = isAdmin || isOwnerWithSufficientRole || isModeratorOwner;

            if (shouldAllow) {
              expect(response.status).toBe(200);
            } else {
              expect(response.status).toBe(403);
            }
          }
        ),
        { numRuns: 150 }
      );
    });
  });
});
