import { describe, test, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import * as fc from "fast-check";

type Role = "ADMIN" | "MODERATOR" | "CAMPAIGN_CREATOR" | "DONOR";

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
 * Returns: "allow" | "redirect:/"
 */
function checkRouteAccess(
  pathname: string,
  userRole: Role | null | undefined,
  assignments: MiddlewareAssignment[] = []
): string {
  const req = new NextRequest(`http://localhost:3000${pathname}`) as NextRequest & {
    nextauth: { token: { role?: Role; assignments: MiddlewareAssignment[] } };
  };
  req.nextauth = { token: { role: userRole ?? undefined, assignments } };
  const response = (middleware as unknown as (r: NextRequest) => Response)(req);
  const location = response.headers.get("location");
  return location ? `redirect:${new URL(location).pathname}` : "allow";
}

// Valid roles as defined in the system
const VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

// Arbitrary that generates valid Role values
const roleArb = fc.constantFrom<Role>(...VALID_ROLES);

// Arbitrary that generates any set of assignments a token can carry
const assignmentsArb = fc.subarray<MiddlewareAssignment>(["ADMIN", "VERIFIER"]);

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
  // Capacity-judgement ticket 03: Admin power comes only from the ADMIN
  // assignment (ADR 0005), never from the Role.

  test("only the ADMIN assignment grants access to /admin routes, whatever the Role", () => {
    fc.assert(
      fc.property(roleArb, assignmentsArb, adminPathArb, (role, assignments, adminPath) => {
        const result = checkRouteAccess(adminPath, role, assignments);

        if (assignments.includes("ADMIN")) {
          expect(result).toBe("allow");
        } else {
          expect(result).toBe("redirect:/");
        }
      }),
      { numRuns: 200 }
    );
  });

  test("the ADMIN Role without the ADMIN assignment is always redirected from admin routes", () => {
    fc.assert(
      fc.property(adminPathArb, (adminPath) => {
        expect(checkRouteAccess(adminPath, "ADMIN", [])).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });

  test("the ADMIN assignment without the ADMIN Role can access any admin sub-route", () => {
    fc.assert(
      fc.property(adminPathArb, (adminPath) => {
        expect(checkRouteAccess(adminPath, "DONOR", ["ADMIN"])).toBe("allow");
      }),
      { numRuns: 100 }
    );
  });

  test("null/undefined role with no assignments is denied access to admin routes", () => {
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
  // campaign-rule-bugs ticket 04: Verifier power comes only from the
  // VERIFIER assignment (ADR 0005), never from the Role, the same list
  // /moderasi/layout.tsx reads.

  test("only the VERIFIER assignment grants access to /moderasi routes, whatever the Role", () => {
    fc.assert(
      fc.property(roleArb, assignmentsArb, moderasiPathArb, (role, assignments, moderasiPath) => {
        const result = checkRouteAccess(moderasiPath, role, assignments);

        if (assignments.includes("VERIFIER")) {
          expect(result).toBe("allow");
        } else {
          expect(result).toBe("redirect:/");
        }
      }),
      { numRuns: 200 }
    );
  });

  test("the MODERATOR or ADMIN Role without the VERIFIER assignment is always redirected from moderasi routes", () => {
    fc.assert(
      fc.property(fc.constantFrom<Role>("MODERATOR", "ADMIN"), moderasiPathArb, (role, moderasiPath) => {
        expect(checkRouteAccess(moderasiPath, role, ["ADMIN"])).toBe("redirect:/");
        expect(checkRouteAccess(moderasiPath, role, [])).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });

  test("the VERIFIER assignment without the MODERATOR Role can access any moderasi sub-route", () => {
    fc.assert(
      fc.property(fc.constantFrom<Role>("DONOR", "CAMPAIGN_CREATOR"), moderasiPathArb, (role, moderasiPath) => {
        expect(checkRouteAccess(moderasiPath, role, ["VERIFIER"])).toBe("allow");
      }),
      { numRuns: 100 }
    );
  });

  test("null/undefined role with no assignments is denied access to moderasi routes", () => {
    const missingRoleArb = fc.constantFrom<null | undefined>(null, undefined);

    fc.assert(
      fc.property(missingRoleArb, moderasiPathArb, (missingRole, moderasiPath) => {
        const result = checkRouteAccess(moderasiPath, missingRole);
        expect(result).toBe("redirect:/");
      }),
      { numRuns: 100 }
    );
  });

  test("any signed-in user reaches /campaign/create, whatever the Role or assignments (FFI-04)", () => {
    const campaignCreatePathArb = subPathArb.map((segments) => {
      if (segments.length === 0) return "/campaign/create";
      return "/campaign/create/" + segments.join("/");
    });
    const anyRoleArb = fc.constantFrom<Role | null | undefined>(...VALID_ROLES, null, undefined);

    fc.assert(
      fc.property(campaignCreatePathArb, anyRoleArb, assignmentsArb, (createPath, role, assignments) => {
        expect(checkRouteAccess(createPath, role, assignments)).toBe("allow");
      }),
      { numRuns: 100 }
    );
  });
});
