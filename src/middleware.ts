import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Local types to avoid importing from @prisma/client (edge-runtime compatibility)
type Role = "ADMIN" | "MODERATOR" | "CAMPAIGN_CREATOR" | "DONOR";
type Assignment = "ADMIN" | "VERIFIER";

// Role hierarchy: higher number = more privilege. Only the /moderasi and
// /campaign/create gates below still read it (prd-compliance tickets 06-08).
const ROLE_LEVELS: Record<Role, number> = {
  DONOR: 0,
  CAMPAIGN_CREATOR: 1,
  MODERATOR: 2,
  ADMIN: 3,
};

// Routes gated by an assignment (ADR 0005): Admin power comes only from the
// ADMIN assignment, never from the Role. The session token carries the
// assignments (see the jwt callback in src/lib/auth.ts), the same list
// admin/layout.tsx and moderasi/layout.tsx read from the session.
const ASSIGNMENT_ROUTES: { pattern: string; assignment: Assignment }[] = [
  { pattern: "/admin", assignment: "ADMIN" },
];

// Route-to-minimum-role mapping. Legacy Role gates, left until who may create
// a Campaign and who verifies are decided (prd-compliance tickets 06-08).
// /moderasi/layout.tsx already requires the VERIFIER assignment behind this
// gate.
const ROLE_ROUTES: { pattern: string; minimumRole: Role }[] = [
  { pattern: "/moderasi", minimumRole: "MODERATOR" },
  { pattern: "/campaign/create", minimumRole: "CAMPAIGN_CREATOR" },
];

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const userRole = (token?.role as Role) ?? "DONOR";
    const assignments = (token?.assignments as Assignment[] | undefined) ?? [];

    for (const route of ASSIGNMENT_ROUTES) {
      if (pathname.startsWith(route.pattern) && !assignments.includes(route.assignment)) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    for (const route of ROLE_ROUTES) {
      if (pathname.startsWith(route.pattern)) {
        if (ROLE_LEVELS[userRole] < ROLE_LEVELS[route.minimumRole]) {
          // Special case: DONOR on /campaign/create goes to /akun, which
          // explains that an Admin registers Fundraisers
          if (route.pattern === "/campaign/create" && userRole === "DONOR") {
            return NextResponse.redirect(new URL("/akun", req.url));
          }
          // All other insufficient role cases redirect to home
          return NextResponse.redirect(new URL("/", req.url));
        }
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    "/donasi-saya/:path*",
    "/inbox/:path*",
    "/akun/:path*",
    "/campaign/create/:path*",
    "/admin/:path*",
    "/moderasi/:path*",
  ],
};
