# 44: Grant and revoke assignments from the admin panel (UI)

**What to build:** `src/app/admin/users/page.tsx` currently has a role-change dropdown and nothing else — no way to see or change someone's Verifier/Admin assignments. This ticket adds that surface: an Admin can see a user's current assignments and grant or revoke each one, calling the API ticket 42 builds.

**Blocked by:** 42

**Status:** ready-for-agent

- [ ] The admin user list or detail view shows each user's current assignments (Verifier, Admin), not just their Role
- [ ] An Admin can grant or revoke a specific assignment from this view, calling ticket 42's API
- [ ] The grant/revoke audit trail (who, when) ticket 42 records is visible somewhere reachable from this page — at minimum on the user whose assignments changed
- [ ] Loading and error states match the existing role-change dropdown's pattern in the same file, rather than inventing a new one

**Context:** split from ticket 42 during that ticket's `/specflow:spec-to-plan` pass, matching the existing API/UI split between tickets 27 (Payout completion API) and 28 (Fundraiser Payout UI). Ticket 42 is backend-only on purpose — this ticket is the surface an Admin actually uses.
