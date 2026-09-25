import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Local role type to avoid importing from @prisma/client (edge-runtime compatibility)
type Role = "ADMIN" | "MODERATOR" | "CAMPAIGN_CREATOR" | "DONOR";

// Role hierarchy: higher number = more privilege
const ROLE_LEVELS: Record<Role, number> = {
  DONOR: 0,
  CAMPAIGN_CREATOR: 1,
  MODERATOR: 2,
  ADMIN: 3,
};

// Route-to-minimum-role mapping
const ROLE_ROUTES: { pattern: string; minimumRole: Role }[] = [
  { pattern: "/admin", minimumRole: "ADMIN" },
  { pattern: "/moderasi", minimumRole: "MODERATOR" },
  { pattern: "/campaign/create", minimumRole: "CAMPAIGN_CREATOR" },
];

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const userRole = (token?.role as Role) ?? "DONOR";

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
