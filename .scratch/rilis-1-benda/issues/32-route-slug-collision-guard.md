# 32: A test that refuses two dynamic segment names at the same route path

**Type:** implementation

**Status:** ready-for-agent

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
