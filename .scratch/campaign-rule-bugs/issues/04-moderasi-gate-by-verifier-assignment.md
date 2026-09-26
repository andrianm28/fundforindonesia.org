# 04: A Verifier reaches /moderasi by assignment, not by the legacy Role

**What to build:** The middleware still gates `/moderasi` on the legacy MODERATOR Role rank (`ROLE_LEVELS`). A person holding the VERIFIER assignment without that Role is redirected before `moderasi/layout.tsx`, which checks the VERIFIER assignment, can admit them. And someone with the Role but no assignment passes the middleware only to be refused by the layout. ADR 0005 makes Verifier an assignment. Move `/moderasi` into the middleware's `ASSIGNMENT_ROUTES` (VERIFIER), next to `/admin` (ADMIN), which capacity-judgement ticket 03 already moved.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] The middleware admits `/moderasi` for anyone with the VERIFIER assignment, whatever their Role, and redirects anyone without it, whatever their Role
- [ ] The Role gate for `/moderasi` is removed; `/campaign/create` stays on the Role, with its tickets 06–08 comment
- [ ] Middleware tests, driving the real middleware, cover assignment-without-Role (allowed) and Role-without-assignment (redirected). The roles-expand guard pins the new gate
- [ ] Full suite green, tsc adds no errors
