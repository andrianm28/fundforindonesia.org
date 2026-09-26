# 03: Drop the legacy status column

**What to build:** A migration that drops `Campaign.status` and its index. It deploys only after ticket 02 is live in production, so a code rollback to the previous release still works: that release neither reads nor needs the column.

**Blocked by:** 02, plus confirmation that ticket 02 is deployed to production

**Status:** ready-for-human

Why human: this is a destructive migration whose timing depends on the production deploy. The operator confirms step 2 is live, then an agent or a person writes and applies it.

- [ ] Ticket 02 confirmed live in production
- [ ] The drop migration is written, applied to a Postgres at the step-2 state, and `migrate diff` is empty
- [ ] The schema no longer declares `status`. Full suite green

## Comments

- 2026-09-26 (from ticket 02): also remove the three `omit: { status: true }` (the list route, POST /api/campaigns, PATCH /api/campaigns/[slug]), the guard test `src/__tests__/campaign-status-readers.test.ts`, its helper `tests/support/campaign-status-column-references.ts`, and the canary `tests/support/campaign-status-canary.ts`. The canary will not type-check once the column is gone.
