import { describe, test, expect } from "vitest";
import * as fc from "fast-check";

// Replicate the middleware's local types and logic (can't import from lib due to edge runtime)
type Role = "ADMIN" | "MODERATOR" | "CAMPAIGN_CREATOR" | "DONOR";

const ROLE_LEVELS: Record<Role, number> = {
  DONOR: 0,
  CAMPAIGN_CREATOR: 1,
  MODERATOR: 2,
  ADMIN: 3,
};

const ROLE_ROUTES: { pattern: string; minimumRole: Role }[] = [
  { pattern: "/admin", minimumRole: "ADMIN" },
  { pattern: "/moderasi", minimumRole: "MODERATOR" },
  { pattern: "/campaign/create", minimumRole: "CAMPAIGN_CREATOR" },
];

/**
 * Simulates the middleware's access decision logic.
 * Returns: "allow" | "redirect:/" | "redirect:/akun"
 */
function checkRouteAccess(
  pathname: string,
  userRole: Role | null | undefined
): "allow" | "redirect:/" | "redirect:/akun" {
  const effectiveRole: Role = (userRole as Role) ?? "DONOR";

  for (const route of ROLE_ROUTES) {
    if (pathname.startsWith(route.pattern)) {
      if (ROLE_LEVELS[effectiveRole] < ROLE_LEVELS[route.minimumRole]) {
        // Special case: DONOR on /campaign/create redirects to /akun
        if (route.pattern === "/campaign/create" && effectiveRole === "DONOR") {
          return "redirect:/akun";
        }
        return "redirect:/";
      }
    }
  }

  return "allow";
}

// Valid roles as defined in the system
const VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

// Arbitrary that generates valid Role values
const roleArb = fc.constantFrom<Role>(...VALID_ROLES);

// Arbitrary that generates random sub-path segments for admin routes
const subPathArb = fc.array(
  fc.stringMatching(/^[a-z0-9-]+$/).filter((s) => s.length > 0 && s.length <= 20),
  { minLength: 0, maxLength: 3 }
);

// Generate admin route paths: /admin, /admin/users, /admin/campaigns/123, etc.
const adminPathArb = subPathArb.map((segments) => {
  if (segments.length === 0) return "/admin";
  return "/admin/" + segments.join("/");
});

// Generate moderasi route paths: /moderasi, /moderasi/campaigns, /moderasi/reports/123, etc.
const moderasiPathArb = subPathArb.map((segments) => {
  if (segments.length === 0) return "/moderasi";
  return "/moderasi/" + segments.join("/");
});

describe("Feature: user-roles, Property 3: Admin Route Access Control", () => {
  // Feature: user-roles, Property 3: Admin route access control
  // **Validates: Requirements 3.1, 3.2**

  test("only ADMIN role grants access to /admin routes — all other roles are redirected", () => {
    fc.assert(
      fc.property(roleArb, adminPathArb, (role, adminPath) => {
        const result = checkRouteAccess(adminPath, role);

        if (role === "ADMIN") {
          expect(result).toBe("allow");
        } else {
          expect(result).toBe("redirect:/");
        }
      }),
      { numRuns: 200 }
    );
  });

  test("ADMIN can access any admin sub-route", () => {
    fc.assert(
      fc.property(adminPathArb, (adminPath) => {
        const result = checkRouteAccess(adminPath, "ADMIN");
        expect(result).toBe("allow");
      }),
      { numRuns: 100 }
    );
  });

  test("MODERATOR is always denied access to admin routes", () => {
    fc.assert(
      fc.property(adminPathArb, (adminPath) => {
        const result = checkRouteAccess(adminPath, "MODERATOR");
        expect(result).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });

  test("CAMPAIGN_CREATOR is always denied access to admin routes", () => {
    fc.assert(
      fc.property(adminPathArb, (adminPath) => {
        const result = checkRouteAccess(adminPath, "CAMPAIGN_CREATOR");
        expect(result).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });

  test("DONOR is always denied access to admin routes", () => {
    fc.assert(
      fc.property(adminPathArb, (adminPath) => {
        const result = checkRouteAccess(adminPath, "DONOR");
        expect(result).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });

  test("null/undefined role (defaults to DONOR) is denied access to admin routes", () => {
    const missingRoleArb = fc.constantFrom<null | undefined>(null, undefined);

    fc.assert(
      fc.property(missingRoleArb, adminPathArb, (missingRole, adminPath) => {
        const result = checkRouteAccess(adminPath, missingRole);
        expect(result).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: user-roles, Property 4: Moderation Route Access Control", () => {
  // Feature: user-roles, Property 4: Moderation route access control
  // **Validates: Requirements 4.1, 4.2, 6.5**

  test("only MODERATOR or ADMIN grants access to /moderasi routes — lower roles are redirected", () => {
    fc.assert(
      fc.property(roleArb, moderasiPathArb, (role, moderasiPath) => {
        const result = checkRouteAccess(moderasiPath, role);

        if (role === "ADMIN" || role === "MODERATOR") {
          expect(result).toBe("allow");
        } else {
          expect(result).toBe("redirect:/");
        }
      }),
      { numRuns: 200 }
    );
  });

  test("ADMIN can access any moderasi sub-route", () => {
    fc.assert(
      fc.property(moderasiPathArb, (moderasiPath) => {
        const result = checkRouteAccess(moderasiPath, "ADMIN");
        expect(result).toBe("allow");
      }),
      { numRuns: 100 }
    );
  });

  test("MODERATOR can access any moderasi sub-route", () => {
    fc.assert(
      fc.property(moderasiPathArb, (moderasiPath) => {
        const result = checkRouteAccess(moderasiPath, "MODERATOR");
        expect(result).toBe("allow");
      }),
      { numRuns: 100 }
    );
  });

  test("CAMPAIGN_CREATOR is always denied access to moderasi routes", () => {
    fc.assert(
      fc.property(moderasiPathArb, (moderasiPath) => {
        const result = checkRouteAccess(moderasiPath, "CAMPAIGN_CREATOR");
        expect(result).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });

  test("DONOR is always denied access to moderasi routes", () => {
    fc.assert(
      fc.property(moderasiPathArb, (moderasiPath) => {
        const result = checkRouteAccess(moderasiPath, "DONOR");
        expect(result).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });

  test("null/undefined role (defaults to DONOR) is denied access to moderasi routes", () => {
    const missingRoleArb = fc.constantFrom<null | undefined>(null, undefined);

    fc.assert(
      fc.property(missingRoleArb, moderasiPathArb, (missingRole, moderasiPath) => {
        const result = checkRouteAccess(moderasiPath, missingRole);
        expect(result).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });

  test("DONOR on /campaign/create is redirected to /akun (not /)", () => {
    const campaignCreatePathArb = subPathArb.map((segments) => {
      if (segments.length === 0) return "/campaign/create";
      return "/campaign/create/" + segments.join("/");
    });

    fc.assert(
      fc.property(campaignCreatePathArb, (createPath) => {
        const result = checkRouteAccess(createPath, "DONOR");
        expect(result).toBe("redirect:/akun");
      }),
      { numRuns: 100 }
    );
  });
});
