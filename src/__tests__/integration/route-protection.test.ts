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

// ─── Middleware Route Access Logic (replicates edge-runtime middleware) ───

type MiddlewareRole = "ADMIN" | "MODERATOR" | "CAMPAIGN_CREATOR" | "DONOR";

const ROLE_LEVELS: Record<MiddlewareRole, number> = {
  DONOR: 0,
  CAMPAIGN_CREATOR: 1,
  MODERATOR: 2,
  ADMIN: 3,
};

const ROLE_ROUTES: { pattern: string; minimumRole: MiddlewareRole }[] = [
  { pattern: "/admin", minimumRole: "ADMIN" },
  { pattern: "/moderasi", minimumRole: "MODERATOR" },
  { pattern: "/campaign/create", minimumRole: "CAMPAIGN_CREATOR" },
];

/**
 * Simulates the middleware's access decision logic.
 * Returns: "allow" | "redirect:/" | "redirect:/akun/verifikasi"
 */
function checkRouteAccess(
  pathname: string,
  userRole: MiddlewareRole | null | undefined
): "allow" | "redirect:/" | "redirect:/akun/verifikasi" {
  const effectiveRole: MiddlewareRole = (userRole as MiddlewareRole) ?? "DONOR";

  for (const route of ROLE_ROUTES) {
    if (pathname.startsWith(route.pattern)) {
      if (ROLE_LEVELS[effectiveRole] < ROLE_LEVELS[route.minimumRole]) {
        // Special case: DONOR on /campaign/create redirects to verification page
        if (route.pattern === "/campaign/create" && effectiveRole === "DONOR") {
          return "redirect:/akun/verifikasi";
        }
        return "redirect:/";
      }
    }
  }

  return "allow";
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

    it("DONOR on /campaign/create redirects to /akun/verifikasi (not /)", () => {
      const result = checkRouteAccess("/campaign/create", "DONOR");
      expect(result).toBe("redirect:/akun/verifikasi");
    });

    it("DONOR on /campaign/create/step-2 also redirects to /akun/verifikasi", () => {
      const result = checkRouteAccess("/campaign/create/step-2", "DONOR");
      expect(result).toBe("redirect:/akun/verifikasi");
    });
  });

  describe("Middleware Route Access: MODERATOR permissions", () => {
    // **Validates: Requirements 3.2, 4.1**

    it("MODERATOR can access /moderasi route — allowed", () => {
      const result = checkRouteAccess("/moderasi", "MODERATOR");
      expect(result).toBe("allow");
    });

    it("MODERATOR can access /moderasi/campaigns — allowed", () => {
      const result = checkRouteAccess("/moderasi/campaigns", "MODERATOR");
      expect(result).toBe("allow");
    });

    it("MODERATOR can access /moderasi/reports — allowed", () => {
      const result = checkRouteAccess("/moderasi/reports", "MODERATOR");
      expect(result).toBe("allow");
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

    it("ADMIN can access /admin route — allowed", () => {
      const result = checkRouteAccess("/admin", "ADMIN");
      expect(result).toBe("allow");
    });

    it("ADMIN can access /admin/users — allowed", () => {
      const result = checkRouteAccess("/admin/users", "ADMIN");
      expect(result).toBe("allow");
    });

    it("ADMIN can access /admin/campaigns — allowed", () => {
      const result = checkRouteAccess("/admin/campaigns", "ADMIN");
      expect(result).toBe("allow");
    });

    it("ADMIN can access /moderasi route — allowed", () => {
      const result = checkRouteAccess("/moderasi", "ADMIN");
      expect(result).toBe("allow");
    });

    it("ADMIN can access /moderasi/campaigns — allowed", () => {
      const result = checkRouteAccess("/moderasi/campaigns", "ADMIN");
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

    it("null role on /campaign/create redirects to /akun/verifikasi", () => {
      const result = checkRouteAccess("/campaign/create", null);
      expect(result).toBe("redirect:/akun/verifikasi");
    });
  });
});
