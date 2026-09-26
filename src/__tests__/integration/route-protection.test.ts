import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@/generated/prisma/client";

// Mock the auth module
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "@/lib/auth";
import { withRoleCheck } from "@/lib/withRoleCheck";

const mockedGetServerSession = vi.mocked(getServerSession);

// ─── Middleware Route Access (the real middleware) ───

type MiddlewareRole = "ADMIN" | "MODERATOR" | "CAMPAIGN_CREATOR" | "DONOR";

// Drive the real middleware: withAuth only decodes the session cookie into
// req.nextauth.token before calling our function, so stand in for that.
// (These tests used to replicate the middleware's logic, and kept passing
// on the copy when the real gate changed.)
vi.mock("next-auth/middleware", () => ({
  withAuth: (middleware: unknown) => middleware,
}));

import middleware from "@/middleware";

type MiddlewareAssignment = "ADMIN" | "VERIFIER";

/**
 * Runs the middleware for a signed-in user with this Role and these
 * assignments (the session token carries both; see src/lib/auth.ts).
 * Returns: "allow" | "redirect:/" | "redirect:/akun"
 */
function checkRouteAccess(
  pathname: string,
  userRole: MiddlewareRole | null | undefined,
  assignments: MiddlewareAssignment[] = []
): string {
  const req = new NextRequest(`http://localhost:3000${pathname}`) as NextRequest & {
    nextauth: { token: { role?: MiddlewareRole; assignments: MiddlewareAssignment[] } };
  };
  req.nextauth = { token: { role: userRole ?? undefined, assignments } };
  const response = (middleware as unknown as (r: NextRequest) => Response)(req);
  const location = response.headers.get("location");
  return location ? `redirect:${new URL(location).pathname}` : "allow";
}

// ─── Helper functions ───

function createMockRequest(url: string, method = "GET"): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method });
}

function mockSessionWithRole(role: Role) {
  return {
    user: {
      id: "test-user-id",
      name: "Test User",
      email: "test@example.com",
      role,
      isVerified: role !== "DONOR",
      verificationType: role !== "DONOR" ? "ktp" : null,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

const successHandler = async (_req: NextRequest) => {
  return NextResponse.json({ success: true }, { status: 200 });
};

// ─── Integration Tests ───

describe("Route Protection Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Middleware Route Access: DONOR restrictions", () => {
    // **Validates: Requirements 3.2, 4.2, 6.5**

    it("DONOR cannot access /admin route — redirected to home", () => {
      const result = checkRouteAccess("/admin", "DONOR");
      expect(result).toBe("redirect:/");
    });

    it("DONOR cannot access /admin/users route — redirected to home", () => {
      const result = checkRouteAccess("/admin/users", "DONOR");
      expect(result).toBe("redirect:/");
    });

    it("DONOR cannot access /admin/campaigns route — redirected to home", () => {
      const result = checkRouteAccess("/admin/campaigns", "DONOR");
      expect(result).toBe("redirect:/");
    });

    it("DONOR cannot access /moderasi route — redirected to home", () => {
      const result = checkRouteAccess("/moderasi", "DONOR");
      expect(result).toBe("redirect:/");
    });

    it("DONOR cannot access /moderasi/campaigns route — redirected to home", () => {
      const result = checkRouteAccess("/moderasi/campaigns", "DONOR");
      expect(result).toBe("redirect:/");
    });

    it("DONOR cannot access /moderasi/reports route — redirected to home", () => {
      const result = checkRouteAccess("/moderasi/reports", "DONOR");
      expect(result).toBe("redirect:/");
    });

    it("DONOR on /campaign/create redirects to /akun (not /)", () => {
      const result = checkRouteAccess("/campaign/create", "DONOR");
      expect(result).toBe("redirect:/akun");
    });

    it("DONOR on /campaign/create/step-2 also redirects to /akun", () => {
      const result = checkRouteAccess("/campaign/create/step-2", "DONOR");
      expect(result).toBe("redirect:/akun");
    });
  });

  describe("Middleware Route Access: MODERATOR permissions", () => {
    // **Validates: Requirements 3.2, 4.1**

    it("the VERIFIER assignment can access /moderasi — allowed", () => {
      const result = checkRouteAccess("/moderasi", "MODERATOR", ["VERIFIER"]);
      expect(result).toBe("allow");
    });

    it("the VERIFIER assignment can access /moderasi/campaigns — allowed", () => {
      const result = checkRouteAccess("/moderasi/campaigns", "MODERATOR", ["VERIFIER"]);
      expect(result).toBe("allow");
    });

    it("the VERIFIER assignment can access /moderasi/reports — allowed", () => {
      const result = checkRouteAccess("/moderasi/reports", "MODERATOR", ["VERIFIER"]);
      expect(result).toBe("allow");
    });

    it("the VERIFIER assignment without the MODERATOR Role can access /moderasi — allowed", () => {
      const result = checkRouteAccess("/moderasi", "DONOR", ["VERIFIER"]);
      expect(result).toBe("allow");
    });

    it("the MODERATOR Role without the VERIFIER assignment cannot access /moderasi — redirected to home", () => {
      const result = checkRouteAccess("/moderasi", "MODERATOR");
      expect(result).toBe("redirect:/");
    });

    it("MODERATOR cannot access /admin route — redirected to home", () => {
      const result = checkRouteAccess("/admin", "MODERATOR");
      expect(result).toBe("redirect:/");
    });

    it("MODERATOR cannot access /admin/users — redirected to home", () => {
      const result = checkRouteAccess("/admin/users", "MODERATOR");
      expect(result).toBe("redirect:/");
    });

    it("MODERATOR can access /campaign/create — allowed (hierarchy)", () => {
      const result = checkRouteAccess("/campaign/create", "MODERATOR");
      expect(result).toBe("allow");
    });
  });

  describe("Middleware Route Access: ADMIN permissions", () => {
    // **Validates: Requirements 3.1, 4.1**

    it("the ADMIN assignment can access /admin — allowed", () => {
      const result = checkRouteAccess("/admin", "ADMIN", ["ADMIN"]);
      expect(result).toBe("allow");
    });

    it("the ADMIN assignment can access /admin/users — allowed", () => {
      const result = checkRouteAccess("/admin/users", "ADMIN", ["ADMIN"]);
      expect(result).toBe("allow");
    });

    it("the ADMIN assignment can access /admin/campaigns — allowed", () => {
      const result = checkRouteAccess("/admin/campaigns", "ADMIN", ["ADMIN"]);
      expect(result).toBe("allow");
    });

    it("the ADMIN Role without the ADMIN assignment cannot access /admin — redirected to home", () => {
      const result = checkRouteAccess("/admin", "ADMIN");
      expect(result).toBe("redirect:/");
    });

    it("the ADMIN assignment without the ADMIN Role can access /admin — allowed", () => {
      const result = checkRouteAccess("/admin", "DONOR", ["ADMIN"]);
      expect(result).toBe("allow");
    });

    it("the ADMIN Role and assignment without VERIFIER cannot access /moderasi — redirected to home", () => {
      const result = checkRouteAccess("/moderasi", "ADMIN", ["ADMIN"]);
      expect(result).toBe("redirect:/");
    });

    it("an Admin who also holds VERIFIER can access /moderasi/campaigns — allowed", () => {
      const result = checkRouteAccess("/moderasi/campaigns", "ADMIN", ["ADMIN", "VERIFIER"]);
      expect(result).toBe("allow");
    });

    it("ADMIN can access /campaign/create — allowed", () => {
      const result = checkRouteAccess("/campaign/create", "ADMIN");
      expect(result).toBe("allow");
    });
  });

  describe("Middleware Route Access: CAMPAIGN_CREATOR permissions", () => {
    // **Validates: Requirements 5.2, 5.3**

    it("CAMPAIGN_CREATOR can access /campaign/create — allowed", () => {
      const result = checkRouteAccess("/campaign/create", "CAMPAIGN_CREATOR");
      expect(result).toBe("allow");
    });

    it("CAMPAIGN_CREATOR cannot access /admin — redirected to home", () => {
      const result = checkRouteAccess("/admin", "CAMPAIGN_CREATOR");
      expect(result).toBe("redirect:/");
    });

    it("CAMPAIGN_CREATOR cannot access /moderasi — redirected to home", () => {
      const result = checkRouteAccess("/moderasi", "CAMPAIGN_CREATOR");
      expect(result).toBe("redirect:/");
    });
  });

  describe("API Route Protection via withRoleCheck: DONOR", () => {
    // **Validates: Requirements 3.2, 4.2**

    it("DONOR gets 403 on admin-protected API endpoint", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("DONOR"));

      const adminHandler = withRoleCheck("ADMIN", successHandler);
      const req = createMockRequest("/api/admin/users");
      const response = await adminHandler(req);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });

    it("DONOR gets 403 on moderator-protected API endpoint", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("DONOR"));

      const modHandler = withRoleCheck("MODERATOR", successHandler);
      const req = createMockRequest("/api/moderasi/campaigns/123");
      const response = await modHandler(req);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });

    it("DONOR gets 403 on campaign-creator-protected API endpoint", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("DONOR"));

      const creatorHandler = withRoleCheck("CAMPAIGN_CREATOR", successHandler);
      const req = createMockRequest("/api/campaigns", "POST");
      const response = await creatorHandler(req);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });
  });

  describe("API Route Protection via withRoleCheck: MODERATOR", () => {
    // **Validates: Requirements 4.1, 3.2**

    it("MODERATOR can access moderator-protected API endpoint — 200", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("MODERATOR"));

      const modHandler = withRoleCheck("MODERATOR", successHandler);
      const req = createMockRequest("/api/moderasi/campaigns/123", "PATCH");
      const response = await modHandler(req);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it("MODERATOR gets 403 on admin-protected API endpoint", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("MODERATOR"));

      const adminHandler = withRoleCheck("ADMIN", successHandler);
      const req = createMockRequest("/api/admin/users/123/role", "PATCH");
      const response = await adminHandler(req);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });
  });

  describe("API Route Protection via withRoleCheck: ADMIN", () => {
    // **Validates: Requirements 3.1, 4.1**

    it("ADMIN can access admin-protected API endpoint — 200", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("ADMIN"));

      const adminHandler = withRoleCheck("ADMIN", successHandler);
      const req = createMockRequest("/api/admin/users");
      const response = await adminHandler(req);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it("ADMIN can access moderator-protected API endpoint — 200", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("ADMIN"));

      const modHandler = withRoleCheck("MODERATOR", successHandler);
      const req = createMockRequest("/api/moderasi/campaigns/123", "PATCH");
      const response = await modHandler(req);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it("ADMIN can access campaign-creator-protected API endpoint — 200", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("ADMIN"));

      const creatorHandler = withRoleCheck("CAMPAIGN_CREATOR", successHandler);
      const req = createMockRequest("/api/campaigns", "POST");
      const response = await creatorHandler(req);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  describe("API Route Protection via withRoleCheck: CAMPAIGN_CREATOR", () => {
    // **Validates: Requirements 5.2, 5.4**

    it("CAMPAIGN_CREATOR can access campaign creation API — 200", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("CAMPAIGN_CREATOR"));

      const creatorHandler = withRoleCheck("CAMPAIGN_CREATOR", successHandler);
      const req = createMockRequest("/api/campaigns", "POST");
      const response = await creatorHandler(req);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it("CAMPAIGN_CREATOR gets 403 on admin-protected API endpoint", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("CAMPAIGN_CREATOR"));

      const adminHandler = withRoleCheck("ADMIN", successHandler);
      const req = createMockRequest("/api/admin/users");
      const response = await adminHandler(req);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });

    it("CAMPAIGN_CREATOR gets 403 on moderator-protected API endpoint", async () => {
      mockedGetServerSession.mockResolvedValue(mockSessionWithRole("CAMPAIGN_CREATOR"));

      const modHandler = withRoleCheck("MODERATOR", successHandler);
      const req = createMockRequest("/api/moderasi/campaigns/123", "PATCH");
      const response = await modHandler(req);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Forbidden");
    });
  });

  describe("API Route Protection: Unauthenticated access", () => {
    // **Validates: Requirements 8.3**

    it("unauthenticated user gets 401 on admin-protected API endpoint", async () => {
      mockedGetServerSession.mockResolvedValue(null);

      const adminHandler = withRoleCheck("ADMIN", successHandler);
      const req = createMockRequest("/api/admin/users");
      const response = await adminHandler(req);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("unauthenticated user gets 401 on moderator-protected API endpoint", async () => {
      mockedGetServerSession.mockResolvedValue(null);

      const modHandler = withRoleCheck("MODERATOR", successHandler);
      const req = createMockRequest("/api/moderasi/campaigns/123", "PATCH");
      const response = await modHandler(req);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("unauthenticated user gets 401 on campaign-creator-protected API endpoint", async () => {
      mockedGetServerSession.mockResolvedValue(null);

      const creatorHandler = withRoleCheck("CAMPAIGN_CREATOR", successHandler);
      const req = createMockRequest("/api/campaigns", "POST");
      const response = await creatorHandler(req);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("Middleware Route Access: Missing/null role defaults to DONOR", () => {
    // **Validates: Requirements 2.4**

    it("null role is treated as DONOR — denied /admin access", () => {
      const result = checkRouteAccess("/admin", null);
      expect(result).toBe("redirect:/");
    });

    it("undefined role is treated as DONOR — denied /moderasi access", () => {
      const result = checkRouteAccess("/moderasi", undefined);
      expect(result).toBe("redirect:/");
    });

    it("null role on /campaign/create redirects to /akun", () => {
      const result = checkRouteAccess("/campaign/create", null);
      expect(result).toBe("redirect:/akun");
    });
  });
});
