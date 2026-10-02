# 43: Fix session-mock type errors left by the assignments field

**What to build:** `tsc --noEmit` is clean again for every test file that constructs a raw `Session`/`NextAuth` mock object, without touching any of those files' actual assertions or behavior.

**Blocked by:** 7

**Status:** in-review

- [ ] Every pre-existing test file that builds a session mock literal (`{ user: { id, role, isVerified, verificationType, ... } }`) without `assignments` gains it, matching this repo's established convention that `Session.user` fields are non-optional
- [ ] No test's runtime assertions change — these are type-only fixes; `npx vitest run` was already fully green before this ticket and must stay that way
- [ ] `src/lib/auth.test.ts`'s two `'session.user' is possibly 'undefined'` errors (lines ~97, ~108) are fixed properly — this one is a narrow, genuine gap in ticket 07's own new test file, not a pre-existing-fixture issue like the rest
- [ ] The `mockResolvedValue`/`'mock' does not exist` Prisma-client-mock-typing errors (search-filter-intersection, profile-name-persistence, api-validation) and the `RequestInit` version-mismatch errors (auth-notifications, role-management, campaigns/[slug]) are confirmed pre-existing and unrelated to `assignments` — do not fix them as part of this ticket unless they turn out to interact; they were already present before ticket 07 and are out of scope here

**Context — how this was found:** `npx tsc --noEmit` jumped from 35 (the baseline right before merging ticket 07) to 86 immediately after. Broken down precisely before filing this: 61 errors trace to `assignments: Assignment[]` becoming a required field on `Session.user` (ticket 07, Task 1) — following this codebase's own pre-existing convention that `role`/`isVerified`/`verificationType` are non-optional too, not a new pattern ticket 07 invented. The other 25 are confirmed unrelated (no file overlap with anything ticket 07 touched) and pre-existing.

Deliberately not fixed inline during ticket 07's merge: 61 errors across roughly a dozen files is a real, scoped body of work, not a one-line fix, and doing it unplanned mid-merge with no task brief and no review would be exactly the kind of scope creep this process exists to avoid. Filed here instead so it gets its own pass.
