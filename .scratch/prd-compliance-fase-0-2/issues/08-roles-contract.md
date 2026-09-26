# 08: Verifier and Admin: contract

**What to build:** The rank ordering is gone. Seniority no longer implies any permission, which is what ADR 0005 requires.

**Blocked by:** 7

**Status:** wontfix

- [ ] The hierarchy is removed from the schema and from any comparison logic
- [ ] No code infers a permission from rank ordering
- [ ] The two-person rule continues to apply to the person, never to the assignment

**Findings folded in from ticket 07's final review** (independently verified by the controller, not just the reviewer's word):

- [ ] `src/middleware.ts` carries its own inline `ROLE_LEVELS`/`ROLE_ROUTES` and still rank-gates `/moderasi` (and `/admin`, `/campaign/create`) at the Next.js middleware layer, running *before* any page-level guard. Ticket 07 only migrated `moderasi/layout.tsx` and `moderasi/page.tsx` themselves — the middleware in front of them still decides on rank. Fail-closed today (not a security hole), but it means ticket 07's own "all role-guarded routes and pages check assignment, not rank" isn't fully true until this migrates too.
- [ ] `src/app/admin/page.tsx` does `session.user.role !== "ADMIN"` directly — a second un-migrated admin page guard sitting alongside `src/app/admin/layout.tsx` (already known, deliberately excluded from ticket 07). Both need the same treatment this ticket gives everything else.
- [ ] The scope-pinning guard (`roles-expand-guard.test.ts`'s `usesHierarchy()` detector) only matches four helper names (`withRoleCheck`, `isAtLeast`, `hasRole`, `requireRole`) and cannot see an inline rank ladder or a direct `role !== "ADMIN"` comparison — which is exactly why the two findings above went undetected by ticket 07's own guard. Extend the detector as part of this ticket, since this ticket's own acceptance criterion ("no code infers a permission from rank ordering") is precisely what a blind detector can't verify.

## Comments

- 2026-09-26: Superseded. The assignments (06) and the guard migration (07) landed through `.scratch/capacity-judgement/` and `campaign-rule-bugs/04`. The contract step (08) is `.scratch/retire-role-hierarchy/`.
