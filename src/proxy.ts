import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Local type to avoid importing from @prisma/client (keeps the proxy lightweight)
type Assignment = "ADMIN" | "VERIFIER";

// Routes gated by an assignment (ADR 0005): Admin and Verifier power come
// only from the ADMIN and VERIFIER assignments, never from the Role. The
// session token carries the assignments (see the jwt callback in
// src/lib/auth.ts), the same list admin/layout.tsx and moderasi/layout.tsx
// read from the session.
const ASSIGNMENT_ROUTES: { pattern: string; assignment: Assignment }[] = [
  { pattern: "/admin", assignment: "ADMIN" },
  { pattern: "/moderasi", assignment: "VERIFIER" },
];

export default withAuth(
  function proxy(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const assignments = (token?.assignments as Assignment[] | undefined) ?? [];

    for (const route of ASSIGNMENT_ROUTES) {
      if (pathname.startsWith(route.pattern) && !assignments.includes(route.assignment)) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Every matched route needs a signed-in user; only ASSIGNMENT_ROUTES
      // ask for more.
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
