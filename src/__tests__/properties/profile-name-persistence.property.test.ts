import { describe, test, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { NextRequest } from "next/server";

// Feature: platform-polish, Property 2: Round trip consistency
// **Validates: Requirements 2.2, 2.3**

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedPrisma = vi.mocked(prisma);

// Helper: create a session for an authenticated user
function mockAuthSession(overrides?: Record<string, unknown>) {
  return {
    user: {
      id: "user-123",
      name: "Original Name",
      email: "test@example.com",
      ...overrides,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Property 2: Profile Name Persistence (Round trip consistency)
// Profile name updates persist in database and reflect in next session refresh
// **Validates: Requirements 2.2, 2.3**
// ============================================================
describe("Feature: platform-polish, Property 2: Profile Name Persistence", () => {
  // Arbitrary for valid names (2-50 characters, non-empty after trim)
  const validNameArb = fc
    .string({ minLength: 2, maxLength: 50 })
    .filter((s) => s.trim().length >= 2);

  test("valid name updates (2-50 chars) always persist and return the updated name", async () => {
    const { PATCH } = await import("@/app/api/user/profile/route");

    await fc.assert(
      fc.asyncProperty(validNameArb, async (name) => {
        vi.clearAllMocks();

        mockedGetServerSession.mockResolvedValue(mockAuthSession());

        // Simulate prisma.user.update returning the updated user with the new name
        mockedPrisma.user.update.mockResolvedValue({
          id: "user-123",
          name: name,
          email: "test@example.com",
          avatar: null,
        } as any);

        const request = new NextRequest(
          new URL("http://localhost:3000/api/user/profile"),
          {
            method: "PATCH",
            body: JSON.stringify({ name }),
            headers: { "Content-Type": "application/json" },
          }
        );

        const response = await PATCH(request);

        // Must succeed with 200
        expect(response.status).toBe(200);

        const body = await response.json();

        // Response must contain the updated name (round-trip)
        expect(body.user).toBeDefined();
        expect(body.user.name).toBe(name);

        // prisma.user.update must have been called with the correct name
        expect(mockedPrisma.user.update).toHaveBeenCalledTimes(1);
        expect(mockedPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "user-123" },
            data: { name },
            select: { id: true, name: true, email: true, avatar: true },
          })
        );
      }),
      { numRuns: 100 }
    );
  });

  test("names shorter than 2 characters are always rejected", async () => {
    const { PATCH } = await import("@/app/api/user/profile/route");

    // Arbitrary for names that are too short (0-1 chars)
    const tooShortNameArb = fc.string({ minLength: 0, maxLength: 1 });

    await fc.assert(
      fc.asyncProperty(tooShortNameArb, async (name) => {
        vi.clearAllMocks();

        mockedGetServerSession.mockResolvedValue(mockAuthSession());

        const request = new NextRequest(
          new URL("http://localhost:3000/api/user/profile"),
          {
            method: "PATCH",
            body: JSON.stringify({ name }),
            headers: { "Content-Type": "application/json" },
          }
        );

        const response = await PATCH(request);

        // Must reject with 400
        expect(response.status).toBe(400);

        // Must never persist to database
        expect(mockedPrisma.user.update).not.toHaveBeenCalled();
      }),
      { numRuns: 50 }
    );
  });

  test("names longer than 50 characters are always rejected", async () => {
    const { PATCH } = await import("@/app/api/user/profile/route");

    // Arbitrary for names that are too long (51+ chars)
    const tooLongNameArb = fc.string({ minLength: 51, maxLength: 200 });

    await fc.assert(
      fc.asyncProperty(tooLongNameArb, async (name) => {
        vi.clearAllMocks();

        mockedGetServerSession.mockResolvedValue(mockAuthSession());

        const request = new NextRequest(
          new URL("http://localhost:3000/api/user/profile"),
          {
            method: "PATCH",
            body: JSON.stringify({ name }),
            headers: { "Content-Type": "application/json" },
          }
        );

        const response = await PATCH(request);

        // Must reject with 400
        expect(response.status).toBe(400);

        // Must never persist to database
        expect(mockedPrisma.user.update).not.toHaveBeenCalled();
      }),
      { numRuns: 50 }
    );
  });

  test("unauthenticated requests are always rejected with 401", async () => {
    const { PATCH } = await import("@/app/api/user/profile/route");

    await fc.assert(
      fc.asyncProperty(validNameArb, async (name) => {
        vi.clearAllMocks();

        // No session
        mockedGetServerSession.mockResolvedValue(null);

        const request = new NextRequest(
          new URL("http://localhost:3000/api/user/profile"),
          {
            method: "PATCH",
            body: JSON.stringify({ name }),
            headers: { "Content-Type": "application/json" },
          }
        );

        const response = await PATCH(request);

        // Must reject with 401
        expect(response.status).toBe(401);

        // Must never persist to database
        expect(mockedPrisma.user.update).not.toHaveBeenCalled();
      }),
      { numRuns: 30 }
    );
  });
});
