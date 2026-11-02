import { withAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import type { NextRequestWithAuth } from "next-auth/middleware";
import createIntlMiddleware from "next-intl/middleware";
import { englishEnabled } from "@/i18n/gate";
import { routing } from "@/i18n/routing";
import { isLocalizedPath } from "@/i18n/scope";
import { LOCALE_SIGNATURE_HEADER, signLocale } from "@/i18n/locale-signature";

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

// --- English (ADR 0024, E7 PR 2) -------------------------------------------
//
// Indonesian is unprefixed and never reaches the language middleware: its
// pages are the app tree as it is. Only /en/* and /id/* are matched below.
// English is served by the very same pages: the middleware turns /en/<path>
// into the page at the internal <path> and tags the request with the locale
// (next-intl's own request header, which src/i18n/request.ts reads).

const intlMiddleware = createIntlMiddleware(routing);

// The same 404 as a page that does not exist (see ASSIGNMENT_ROUTES).
function notFound(req: NextRequest) {
  return NextResponse.rewrite(new URL("/_not-found", req.url), { status: 404 });
}

// The paths the sign-in gate guards, for a path with its language prefix
// stripped: the same list as the matcher below. /akun/verifikasi-email stays
// open so its token never lands in a callbackUrl.
const GATED_PATH =
  /^\/(?:donasi-saya|inbox|campaign\/create)(?:\/|$)|^\/akun(?:\/?$|\/(?!verifikasi-email(?:\/|$)).+)/i;
const BACK_OFFICE_PATH = /^\/(?:admin|moderasi)(?:\/|$)/i;

// Decide on the path as the page router will see it: percent escapes decoded,
// repeated slashes collapsed, so no spelling slips past GATED_PATH.
function normalise(path: string): string | null {
  try {
    const decoded = decodeURIComponent(path).replace(/\/{2,}/g, "/");
    // A control character or whitespace is trimmed or dropped further down
    // (the language middleware, the router), so /admin%00 would be /admin there
    // and something else here. No page has such a path: refuse it.
    return /[\u0000-\u001f\u007f-\u009f\s\u200b-\u200f\u2028\u2029\ufeff]/.test(decoded) ? null : decoded;
  } catch {
    return null; // malformed escape: no page has this path
  }
}

function internalTarget(req: NextRequest, intl: NextResponse): URL {
  const url = new URL(intl.headers.get("x-middleware-rewrite") ?? req.url);
  url.pathname = url.pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  return url;
}

async function answerLocalised(req: NextRequest, event: NextFetchEvent, prefix: "en" | "id") {
  const stripped = normalise(req.nextUrl.pathname.slice(prefix.length + 1) || "/");
  // Pages only: not the back-office, /api, /_next, uploads or root files.
  if (!englishEnabled() || stripped === null || BACK_OFFICE_PATH.test(stripped) || !isLocalizedPath(stripped)) {
    return notFound(req);
  }

  let guardedHere = false;
  if (prefix === "en" && GATED_PATH.test(stripped)) {
    const guarded = await authProxy(req as NextRequestWithAuth, event);
    // Anything but "carry on" (a redirect to /login, a 404) is the answer.
    if (!guarded || guarded.headers.get("x-middleware-next") !== "1") return guarded ?? notFound(req);
    guardedHere = true;
  }

  const intl = intlMiddleware(req);
  // /id/x -> /x, and a path in the other language's spelling -> the right one.
  if (prefix === "id" || intl.headers.has("location")) return intl;

  // Decide again on the path the router will actually see: what the language
  // middleware made of the request must be neither back-office nor a gated
  // page that was not guarded above.
  const target = internalTarget(req, intl);
  const seen = normalise(target.pathname);
  if (seen === null || BACK_OFFICE_PATH.test(seen) || !isLocalizedPath(seen) || (GATED_PATH.test(seen) && !guardedHere)) {
    return notFound(req);
  }

  const page = NextResponse.rewrite(target);
  for (const [name, value] of intl.headers) {
    if (name === "x-middleware-override-headers" || name.startsWith("x-middleware-request-")) {
      page.headers.set(name, value);
    }
  }
  // Proof for src/i18n/request.ts that this proxy tagged the request, not a client.
  const signature = signLocale("en");
  if (signature) {
    page.headers.set(`x-middleware-request-${LOCALE_SIGNATURE_HEADER}`, signature);
    const overridden = page.headers.get("x-middleware-override-headers");
    page.headers.set("x-middleware-override-headers", overridden ? `${overridden},${LOCALE_SIGNATURE_HEADER}` : LOCALE_SIGNATURE_HEADER);
  }
  return page;
}

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  const lead = /^\/(en|id)(?=\/|$)/i.exec(req.nextUrl.pathname)?.[1];
  if (lead) {
    // Only the lower-case prefix is a language; EN or Id is not a page.
    if (lead !== "en" && lead !== "id") return notFound(req);
    return answerLocalised(req, event, lead);
  }
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
    // The language prefixes (ADR 0024). Indonesian pages are not matched.
    "/en",
    "/en/:path*",
    "/id",
    "/id/:path*",
  ],
};
