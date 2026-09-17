import { describe, test, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { Role } from "@/generated/prisma/client";
import { ROLE_LEVELS } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";

// Mock the auth module
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "@/lib/auth";
import { withRoleCheck } from "@/lib/withRoleCheck";

// Valid roles as defined in the system
const VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

// Non-ADMIN roles for Property 6
const NON_ADMIN_ROLES: Role[] = ["MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

// Arbitrary that generates valid Role values
const roleArb = fc.constantFrom<Role>(...VALID_ROLES);

// Arbitrary that generates non-ADMIN Role values
const nonAdminRoleArb = fc.constantFrom<Role>(...NON_ADMIN_ROLES);

// Helper to create a mock NextRequest
function createMockRequest(method = "GET"): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/test"), {
    method,
  });
}

// Helper to create a mock session with the given role
function mockSessionWithRole(role: Role) {
  return {
    user: {
      id: "test-user-id",
      name: "Test User",
      email: "test@example.com",
      role,
      isVerified: true,
      verificationType: null,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

// A simple handler that returns 200 to confirm it was reached
const successHandler = async (_req: NextRequest) => {
  return NextResponse.json({ success: true }, { status: 200 });
};

const mockedGetServerSession = vi.mocked(getServerSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Feature: user-roles, Property 5: API Role Enforcement", () => {
  // Feature: user-roles, Property 5: API Role Enforcement
  // **Validates: Requirements 8.1, 8.2**

  test("users below minimum role always get 403", async () => {
    await fc.assert(
      fc.asyncProperty(roleArb, roleArb, async (userRole, minimumRole) => {
        // Only test cases where the user is BELOW the minimum role
        if (ROLE_LEVELS[userRole] >= ROLE_LEVELS[minimumRole]) return;

        mockedGetServerSession.mockResolvedValue(mockSessionWithRole(userRole));

        const protectedHandler = withRoleCheck(minimumRole, successHandler);
        const req = createMockRequest();
        const response = await protectedHandler(req);

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.error).toBe("Forbidden");
      }),
      { numRuns: 100 }
    );
  });

  test("users at or above minimum role get through (handler is called)", async () => {
    await fc.assert(
      fc.asyncProperty(roleArb, roleArb, async (userRole, minimumRole) => {
        // Only test cases where the user meets or exceeds the minimum role
        if (ROLE_LEVELS[userRole] < ROLE_LEVELS[minimumRole]) return;

        mockedGetServerSession.mockResolvedValue(mockSessionWithRole(userRole));

        const protectedHandler = withRoleCheck(minimumRole, successHandler);
        const req = createMockRequest();
        const response = await protectedHandler(req);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test("for any minimumRole and any userRole, result is strictly determined by ROLE_LEVELS comparison", async () => {
    await fc.assert(
      fc.asyncProperty(roleArb, roleArb, async (userRole, minimumRole) => {
        mockedGetServerSession.mockResolvedValue(mockSessionWithRole(userRole));

        const protectedHandler = withRoleCheck(minimumRole, successHandler);
        const req = createMockRequest();
        const response = await protectedHandler(req);

        const shouldAllow = ROLE_LEVELS[userRole] >= ROLE_LEVELS[minimumRole];

        if (shouldAllow) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(403);
        }
      }),
      { numRuns: 100 }
    );
  });

  test("unauthenticated users always get 401 regardless of minimum role", async () => {
    await fc.assert(
      fc.asyncProperty(roleArb, async (minimumRole) => {
        mockedGetServerSession.mockResolvedValue(null);

        const protectedHandler = withRoleCheck(minimumRole, successHandler);
        const req = createMockRequest();
        const response = await protectedHandler(req);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error).toBe("Unauthorized");
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: user-roles, Property 6: Role Assignment Restricted to Admin", () => {
  // Feature: user-roles, Property 6: Role Assignment Restricted to Admin
  // **Validates: Requirements 4.5, 9.3**

  test("non-ADMIN users always get 403 on role assignment API (withRoleCheck ADMIN)", async () => {
    await fc.assert(
      fc.asyncProperty(nonAdminRoleArb, async (userRole) => {
        mockedGetServerSession.mockResolvedValue(mockSessionWithRole(userRole));

        // The role assignment endpoint is protected with withRoleCheck("ADMIN", ...)
        const roleAssignmentHandler = withRoleCheck("ADMIN", successHandler);
        const req = createMockRequest("PATCH");
        const response = await roleAssignmentHandler(req);

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.error).toBe("Forbidden");
      }),
      { numRuns: 100 }
    );
  });

  test("only ADMIN users can access the role assignment API", async () => {
    await fc.assert(
      fc.asyncProperty(roleArb, async (userRole) => {
        mockedGetServerSession.mockResolvedValue(mockSessionWithRole(userRole));

        const roleAssignmentHandler = withRoleCheck("ADMIN", successHandler);
        const req = createMockRequest("PATCH");
        const response = await roleAssignmentHandler(req);

        if (userRole === "ADMIN") {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(403);
        }
      }),
      { numRuns: 100 }
    );
  });

  test("MODERATOR, CAMPAIGN_CREATOR, and DONOR all get denied role assignment", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonAdminRoleArb,
        fc.constantFrom<Role>(...VALID_ROLES), // target role being assigned (irrelevant)
        async (userRole, _targetRole) => {
          mockedGetServerSession.mockResolvedValue(mockSessionWithRole(userRole));

          // Regardless of what role is being assigned, non-admin is denied
          const roleAssignmentHandler = withRoleCheck("ADMIN", successHandler);
          const req = createMockRequest("PATCH");
          const response = await roleAssignmentHandler(req);

          expect(response.status).toBe(403);
        }
      ),
      { numRuns: 100 }
    );
  });
});
