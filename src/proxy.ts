import { withAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import type { NextRequestWithAuth } from "next-auth/middleware";
import { getToken } from "next-auth/jwt";
import { MAINTENANCE_DEFAULT_MESSAGE, resolveOperations } from "@/lib/operations";

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

export const authProxy = withAuth(
  function proxy(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const assignments = (token?.assignments as Assignment[] | undefined) ?? [];

    for (const route of ASSIGNMENT_ROUTES) {
      // The same 404 as a page that does not exist, not a redirect home that
      // confirms the panel is there (owner decision 2026-10-14, ticket 90).
      // Rewriting to an unmatched path renders the app's not-found page;
      // the status is set here because a notFound() in the layout would come
      // too late, behind the root loading.tsx, to change it from 200.
      if (pathname.startsWith(route.pattern) && !assignments.includes(route.assignment)) {
        return NextResponse.rewrite(new URL("/_not-found", req.url), { status: 404 });
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

// The same reason as the panels above: an unknown Category's page calls
// notFound() behind the root loading.tsx, after the document has begun
// streaming as 200, so a search engine would index /explore/zakat (removed by
// ADR 0025) or any made-up slug as a real page (rilis-1-benda/96). The status
// has to be decided before rendering starts. This is a public path: it never
// asks for a session, and it only answers 404; the page still renders itself.
// /explore/all is a page of its own and has no Category row; it is in the
// matcher only because the pattern cannot exclude it, and passes straight on.
function exploreCategorySlug(pathname: string): string | null {
  const match = /^\/explore\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return ""; // malformed escape: no Category has this slug
  }
}

// A slow or saturated database must not hold every /explore request in the
// proxy: past this, the page gets the request, as when the lookup throws.
const LOOKUP_TIMEOUT_MS = 1000;

async function categoryExists(slug: string): Promise<boolean> {
  if (!slug || slug.includes("\0")) return false; // Postgres refuses a NUL
  if (slug === "all") return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { prisma } = await import("@/lib/prisma");
    const lookup = prisma.category.findUnique({ where: { slug }, select: { id: true } }).then((row) => !!row);
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), LOOKUP_TIMEOUT_MS);
    });
    return await Promise.race([lookup, timeout]);
  } catch {
    // The lookup is only an early status: if the database is unreachable the
    // page gets the request and fails or 404s the way it always did.
    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function answerExploreCategory(req: NextRequest, slug: string) {
  if (await categoryExists(slug)) return NextResponse.next();
  return NextResponse.rewrite(new URL("/_not-found", req.url), { status: 404 });
}

// Mode pemeliharaan (src/lib/operations.ts, PKS ticket 01). While it is on,
// a write to the API is refused with 503 unless the caller is an Admin. Left
// working on purpose: the Admin panel and its API (how maintenance is turned
// off), the webhooks (a payment already under way must still be recorded),
// health (the deploy script polls it), login/logout, the scheduled jobs and
// the browser's error reports. A prefix counts only on a path-segment
// boundary, so /api/administrasi is not /api/admin.
const MAINTENANCE_EXEMPT = [
  "/api/admin",
  "/api/webhooks",
  "/api/health",
  "/api/auth",
  "/api/internal",
  "/api/client-error",
];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isMaintenanceExempt(pathname: string): boolean {
  return MAINTENANCE_EXEMPT.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** The maintenance message while it is on, or null (also when it cannot be read: fail open). */
async function maintenanceMessage(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { prisma } = await import("@/lib/prisma");
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
    });
    const operations = await Promise.race([resolveOperations(prisma), timeout]);
    if (!operations || !operations.maintenance.on) return null;
    return operations.maintenance.message || MAINTENANCE_DEFAULT_MESSAGE;
  } catch {
    // Maintenance is a convenience for the operator: an unreadable row must not take the API down.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function answerApi(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (SAFE_METHODS.has(req.method) || isMaintenanceExempt(pathname)) return NextResponse.next();

  const message = await maintenanceMessage();
  if (message === null) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
  const assignments = (token?.assignments as Assignment[] | undefined) ?? [];
  if (assignments.includes("ADMIN")) return NextResponse.next();

  return NextResponse.json({ error: message }, { status: 503, headers: { "Retry-After": "300" } });
}

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  // The API is not behind the sign-in guard below (each route does its own
  // auth); it only gets the maintenance answer.
  if (req.nextUrl.pathname.startsWith("/api/")) return answerApi(req);
  const slug = exploreCategorySlug(req.nextUrl.pathname);
  if (slug === null) return authProxy(req as NextRequestWithAuth, event);
  return answerExploreCategory(req, slug);
}

export const config = {
  matcher: [
    "/donasi-saya/:path*",
    "/inbox/:path*",
    // /akun/verifikasi-email needs no session (the token is the proof), and
    // must stay out of the matcher: an anonymous visit would otherwise be
    // redirected to /login?callbackUrl=<the link>, putting the token in a URL.
    "/akun",
    "/akun/((?!verifikasi-email(?:/|$)).+)",
    "/campaign/create/:path*",
    "/admin/:path*",
    "/moderasi/:path*",
    // Not a guard: see answerExploreCategory.
    "/explore/:category",
    // Not a guard either: only the maintenance answer, see answerApi.
    "/api/:path*",
  ],
};
