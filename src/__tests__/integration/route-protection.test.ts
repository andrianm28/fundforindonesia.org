import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// Drive the real middleware: withAuth only decodes the session cookie into
// req.nextauth.token before calling our function, so stand in for that.
// (These tests used to replicate the middleware's logic, and kept passing
// on the copy when the real gate changed.)
vi.mock("next-auth/middleware", () => ({
  withAuth: (middleware: unknown) => middleware,
}));

import proxy from "@/proxy";

type MiddlewareAssignment = "ADMIN" | "VERIFIER";

/**
 * Runs the middleware for a signed-in user holding these assignments (the
 * session token carries them; see src/lib/auth.ts). The token carries no
 * Role: the Role hierarchy is retired (ADR 0005).
 * Returns: "allow" | "redirect:/"
 */
function checkRouteAccess(pathname: string, assignments: MiddlewareAssignment[] = []): string {
  const req = new NextRequest(`http://localhost:3000${pathname}`) as NextRequest & {
    nextauth: { token: { assignments: MiddlewareAssignment[] } };
  };
  req.nextauth = { token: { assignments } };
  const response = (proxy as unknown as (r: NextRequest) => Response)(req);
  const location = response.headers.get("location");
  return location ? `redirect:${new URL(location).pathname}` : "allow";
}

describe("Route Protection Integration Tests", () => {
  describe("a signed-in user with no assignment", () => {
    it.each(["/admin", "/admin/users", "/admin/campaigns", "/moderasi", "/moderasi/campaigns", "/moderasi/reports"])(
      "is sent home from %s",
      (path) => {
        expect(checkRouteAccess(path)).toBe("redirect:/");
      },
    );

    it.each(["/campaign/create", "/campaign/create/step-2"])(
      "may open %s: anyone registered may submit (FFI-04)",
      (path) => {
        expect(checkRouteAccess(path)).toBe("allow");
      },
    );
  });

  describe("the VERIFIER assignment (ADR 0005)", () => {
    it.each(["/moderasi", "/moderasi/campaigns", "/moderasi/reports"])("may open %s", (path) => {
      expect(checkRouteAccess(path, ["VERIFIER"])).toBe("allow");
    });

    it.each(["/admin", "/admin/users"])("is sent home from %s", (path) => {
      expect(checkRouteAccess(path, ["VERIFIER"])).toBe("redirect:/");
    });
  });

  describe("the ADMIN assignment (ADR 0005)", () => {
    it.each(["/admin", "/admin/users", "/admin/campaigns"])("may open %s", (path) => {
      expect(checkRouteAccess(path, ["ADMIN"])).toBe("allow");
    });

    it("without VERIFIER is sent home from /moderasi", () => {
      expect(checkRouteAccess("/moderasi", ["ADMIN"])).toBe("redirect:/");
    });

    it("with VERIFIER as well may open /moderasi/campaigns", () => {
      expect(checkRouteAccess("/moderasi/campaigns", ["ADMIN", "VERIFIER"])).toBe("allow");
    });
  });
});
