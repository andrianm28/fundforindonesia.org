# 19: Rename middleware.ts to proxy.ts (Next 16 convention)

**What to build:** Next 16 deprecates the `middleware` file convention in
favour of `proxy`; `next build` warns about it. `src/middleware.ts` (next-auth
v4 `withAuth` plus a `matcher`) guards the protected routes, so the rename must
provably keep every guarded route guarded and every public route public.

**Blocked by:** 15 (Next 16 upgrade, PR #41)

**Status:** done (PR #60, 1109c46)

- [ ] `src/middleware.ts` becomes `src/proxy.ts` with the export shape Next 16 expects; `next build` no longer prints the middleware deprecation notice
- [ ] Tests pin the matcher: each protected prefix redirects an anonymous request, each public path passes through (write them against the current file first, red-green across the rename)
- [ ] Role checks inside the guard are unchanged
- [ ] CI green (test, build, migrations, ratchet, image)
