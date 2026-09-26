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
    },
  },
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { PATCH } from "@/app/api/campaigns/[slug]/route";

const mockFindUnique = vi.mocked(prisma.campaign.findUnique);
const mockUpdate = vi.mocked(prisma.campaign.update);
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

// Arbitrary for the assignments a person holds (ADR 0005)
type Assignment = "ADMIN" | "VERIFIER";
const assignmentsArb = fc.subarray<Assignment>(["ADMIN", "VERIFIER"]);

// Helper to create a mock session
function mockSession(userId: string, role: Role, assignments: Assignment[] = []) {
  return {
    user: {
      id: userId,
      name: "Test User",
      email: "test@example.com",
      role,
      isVerified: true,
      verificationType: null,
      assignments,
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

// Helper to create params context (matching Next.js App Router pattern)
function createParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: update succeeds
  mockUpdate.mockResolvedValue({
    id: "campaign-id-123",
    slug: "test-campaign",
    title: "Updated Title",
    creator: { id: "creator-id", name: "Creator", avatar: null, isVerified: true, verificationType: null },
  } as any);
});

describe("Feature: user-roles, Property 12: Campaign Creator Ownership Enforcement", () => {
  describe("an Admin (the ADMIN assignment) is allowed to edit regardless of ownership", () => {
    test("the ADMIN assignment can always PATCH a campaign it does not own, whatever the Role", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          userIdArb,
          roleArb,
          slugArb,
          async (adminId, creatorId, role, slug) => {
            // Ensure admin is NOT the creator to test non-owner admin access
            fc.pre(adminId !== creatorId);

            mockGetServerSession.mockResolvedValue(mockSession(adminId, role, ["ADMIN"]));
            mockFindUnique.mockResolvedValue(mockCampaign(creatorId) as any);

            const req = createPatchRequest(slug);
            const response = await PATCH(req, createParams(slug) as any);

            expect(response.status).toBe(200);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("the owner can edit, whatever their Role (FFI-04)", () => {
    test("the owner can PATCH their own campaign with no assignment, whatever the Role", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          roleArb,
          slugArb,
          async (userId, role, slug) => {
            // User is both the session user AND the campaign creator
            mockGetServerSession.mockResolvedValue(mockSession(userId, role));
            mockFindUnique.mockResolvedValue(mockCampaign(userId) as any);

            const req = createPatchRequest(slug);
            const response = await PATCH(req, createParams(slug) as any);

            expect(response.status).toBe(200);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("a non-owner without the ADMIN assignment gets 403", () => {
    test("a non-owner is denied PATCH with NOT_AUTHORIZED, whatever the Role", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          userIdArb,
          roleArb,
          slugArb,
          async (userId, creatorId, role, slug) => {
            // Ensure the user is NOT the owner
            fc.pre(userId !== creatorId);

            mockGetServerSession.mockResolvedValue(mockSession(userId, role));
            mockFindUnique.mockResolvedValue(mockCampaign(creatorId) as any);

            const req = createPatchRequest(slug);
            const response = await PATCH(req, createParams(slug) as any);

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body).toEqual({
              error: "Hanya Fundraiser Campaign ini yang dapat melakukan tindakan ini.",
              code: "NOT_AUTHORIZED",
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Comprehensive ownership enforcement property", () => {
    test("For any user/campaign combo: access is determined by ownership OR the ADMIN assignment, never the Role", async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.oneof(userIdArb, fc.constant("same-user")),
          roleArb,
          assignmentsArb,
          slugArb,
          async (rawUserId, creatorId, role, assignments, slug) => {
            const userId = creatorId === "same-user" ? "same-user" : rawUserId;
            mockGetServerSession.mockResolvedValue(mockSession(userId, role, assignments));
            mockFindUnique.mockResolvedValue(mockCampaign(creatorId) as any);

            const req = createPatchRequest(slug);
            const response = await PATCH(req, createParams(slug) as any);

            const isOwner = userId === creatorId;
            // Admin power comes only from the assignment; on their own
            // Campaign an Admin is its Fundraiser (CONTEXT.md, Capacity).
            const actsAsAdmin = !isOwner && assignments.includes("ADMIN");
            const shouldAllow = isOwner || actsAsAdmin;

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
