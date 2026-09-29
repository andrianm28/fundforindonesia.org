# 32: A test that refuses two dynamic segment names at the same route path

**Type:** implementation

**Status:** in-review

**Blocked by:** none

## Why

Ticket 11's first push (PR 137) put a new route at
`src/app/api/moderasi/bank-accounts/[id]/revocation`, next to the existing
`src/app/api/moderasi/bank-accounts/[requestId]`. Next.js refuses two
differently named dynamic segments at the same position ("You cannot use
different slug names for the same dynamic path"), so the dev server never
started. `test`, `build` and `ratchet` were all green; only `e2e` and `image`
failed, minutes later and with a log that only shows a timeout. The fix was a
move to `bank-account-revocations/[id]`.

The rule is mechanical and cheap to check statically, so it should fail in the
fast `test` job, with the two offending paths in the message, instead of as a
`Timed out waiting 180000ms from config.webServer` in e2e.

## What to build

A vitest guard under `src/__tests__/properties/` (next to
`roles-expand-guard.test.ts`) that walks `src/app` and fails when two sibling
directories under the same parent are both dynamic segments with different
names (`[id]` vs `[requestId]`, including catch-all forms `[...x]` and
`[[...x]]` against a plain `[y]` sibling). The failure message names both
directories.

## Acceptance

- Passes on `main` as it is today.
- A test of the guard itself, using a temporary directory tree, proves it
  fails on `[id]` beside `[requestId]` and passes on `[id]` beside a static
  segment.
- No app code changes; no migration.

## Implementation note (branch `claude/ticket-32-route-slug-guard-impl`)

`src/__tests__/properties/route-slug-collision-guard.test.ts` walks `src/app`
and reports every directory holding two or more dynamic sibling segments
(`[x]`, `[...x]`, `[[...x]]`); two such names can never be equal on disk, so
any pair is a collision. The message names both paths. Six tests on temporary
trees pin `[id]`/`[requestId]` (fail), `[id]` beside a static segment (pass),
the same name under different parents (pass), catch-all and optional catch-all
beside `[y]` (fail), and nested descent. To repeat the PR 137 check, create
`src/app/api/moderasi/bank-accounts/[id]` and run
`npx vitest run src/__tests__/properties/route-slug-collision-guard.test.ts`.
Route groups `(x)` and parallel slots `@x` are not flattened; none collide
today. No app code, migration, or ADR changed.
