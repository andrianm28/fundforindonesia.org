import { describe, test, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { Role, Assignment } from "@/generated/prisma/client";
import { NextRequest } from "next/server";

// Valid roles as defined in the system
const VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

// Non-ADMIN roles for self-demotion tests
const NON_ADMIN_ROLES: Role[] = ["MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

// Mock the auth module
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedPrismaUserUpdate = vi.mocked(prisma.user.update);
const mockedPrismaNotificationCreate = vi.mocked(prisma.notification.create);

// Helper to create a mock session for an ADMIN user
function mockAdminSession(userId: string) {
  return {
    user: {
      id: userId,
      name: "Admin User",
      email: "admin@example.com",
      role: "ADMIN" as Role,
      isVerified: true,
      verificationType: null,
      assignments: ["ADMIN"] as Assignment[],
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

// Helper to create a mock NextRequest with a JSON body
function createMockPatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    new URL("http://localhost:3000/api/admin/users/target-user-id/role"),
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default prisma mocks
  mockedPrismaUserUpdate.mockResolvedValue({
    id: "target-user-id",
    name: "Target User",
    email: "target@example.com",
    role: "DONOR",
  } as any);
  mockedPrismaNotificationCreate.mockResolvedValue({} as any);
});

describe("Feature: user-roles, Property 7: Role Assignment Validation", () => {
  // Feature: user-roles, Property 7: Role Assignment Validation
  // **Validates: Requirements 9.1, 9.2**

  test("invalid role strings are rejected with 400", async () => {
    // We need to import PATCH dynamically after mocks are set up
    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/role/route"
    );

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => !VALID_ROLES.includes(s as Role)
        ),
        async (invalidRole) => {
          const adminId = "admin-user-id";
          mockedGetServerSession.mockResolvedValue(mockAdminSession(adminId));

          const req = createMockPatchRequest({ role: invalidRole });
          const context = { params: Promise.resolve({ id: "target-user-id" }) };

          const response = await PATCH(req, context);

          expect(response.status).toBe(400);
          const body = await response.json();
          expect(body.error).toBe("Invalid role");
        }
      ),
      { numRuns: 100 }
    );
  });

  test("valid role strings are accepted and persisted", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/role/route"
    );

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Role>(...VALID_ROLES),
        async (validRole) => {
          const adminId = "admin-user-id";
          const targetId = "target-user-id";
          mockedGetServerSession.mockResolvedValue(mockAdminSession(adminId));
          mockedPrismaUserUpdate.mockResolvedValue({
            id: targetId,
            name: "Target User",
            email: "target@example.com",
            role: validRole,
          } as any);

          const req = createMockPatchRequest({ role: validRole });
          const context = { params: Promise.resolve({ id: targetId }) };

          const response = await PATCH(req, context);

          expect(response.status).toBe(200);
          const body = await response.json();
          expect(body.user.role).toBe(validRole);

          // Verify prisma was called with the correct role
          expect(mockedPrismaUserUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { id: targetId },
              data: { role: validRole },
            })
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test("empty string role is rejected with 400", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/role/route"
    );

    await fc.assert(
      fc.asyncProperty(
        fc.constant(""),
        async (emptyRole) => {
          const adminId = "admin-user-id";
          mockedGetServerSession.mockResolvedValue(mockAdminSession(adminId));

          const req = createMockPatchRequest({ role: emptyRole });
          const context = { params: Promise.resolve({ id: "target-user-id" }) };

          const response = await PATCH(req, context);

          expect(response.status).toBe(400);
        }
      ),
      { numRuns: 100 }
    );
  });

  test("null/undefined role values are rejected with 400", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/role/route"
    );

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(null, undefined),
        async (nullishRole) => {
          const adminId = "admin-user-id";
          mockedGetServerSession.mockResolvedValue(mockAdminSession(adminId));

          const req = createMockPatchRequest({ role: nullishRole });
          const context = { params: Promise.resolve({ id: "target-user-id" }) };

          const response = await PATCH(req, context);

          expect(response.status).toBe(400);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: user-roles, Property 8: Self-Demotion Prevention", () => {
  // Feature: user-roles, Property 8: Self-Demotion Prevention
  // **Validates: Requirements 9.5**

  test("admin cannot change own role to any non-ADMIN value", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/role/route"
    );

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Role>(...NON_ADMIN_ROLES),
        async (nonAdminRole) => {
          const adminId = "admin-user-id";
          // Admin tries to change their own role
          mockedGetServerSession.mockResolvedValue(mockAdminSession(adminId));

          const req = createMockPatchRequest({ role: nonAdminRole });
          // Target ID matches the admin's own ID
          const context = { params: Promise.resolve({ id: adminId }) };

          const response = await PATCH(req, context);

          expect(response.status).toBe(400);
          const body = await response.json();
          expect(body.error).toBe("Cannot remove ADMIN role from yourself");

          // Verify prisma was NOT called (role not updated)
          expect(mockedPrismaUserUpdate).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  test("admin can keep their own role as ADMIN (self-assignment of ADMIN succeeds)", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/role/route"
    );

    await fc.assert(
      fc.asyncProperty(
        fc.constant("ADMIN" as Role),
        async (adminRole) => {
          const adminId = "admin-user-id";
          mockedGetServerSession.mockResolvedValue(mockAdminSession(adminId));
          mockedPrismaUserUpdate.mockResolvedValue({
            id: adminId,
            name: "Admin User",
            email: "admin@example.com",
            role: adminRole,
          } as any);

          const req = createMockPatchRequest({ role: adminRole });
          // Target ID matches the admin's own ID
          const context = { params: Promise.resolve({ id: adminId }) };

          const response = await PATCH(req, context);

          expect(response.status).toBe(200);
          const body = await response.json();
          expect(body.user.role).toBe("ADMIN");
        }
      ),
      { numRuns: 100 }
    );
  });

  test("admin can change OTHER users to any valid role (not self-demotion)", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/role/route"
    );

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Role>(...VALID_ROLES),
        async (targetRole) => {
          const adminId = "admin-user-id";
          const targetId = "different-target-user-id";
          mockedGetServerSession.mockResolvedValue(mockAdminSession(adminId));
          mockedPrismaUserUpdate.mockResolvedValue({
            id: targetId,
            name: "Target User",
            email: "target@example.com",
            role: targetRole,
          } as any);

          const req = createMockPatchRequest({ role: targetRole });
          // Target ID is different from admin's ID
          const context = { params: Promise.resolve({ id: targetId }) };

          const response = await PATCH(req, context);

          expect(response.status).toBe(200);
          const body = await response.json();
          expect(body.user.role).toBe(targetRole);
        }
      ),
      { numRuns: 100 }
    );
  });
});
