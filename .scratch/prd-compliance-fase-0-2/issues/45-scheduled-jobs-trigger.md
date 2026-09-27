# 45: Run the scheduled jobs in production

**What to build:** Ticket 20 (PR #58) added `runScheduledJobs` (escrow release,
deadline and expiry reminders) but nothing calls it: no route, no scheduler.
Until something does, matured Escrow Hold is never released and no reminder
is sent. Add one production trigger:

- an authenticated internal route (for example `POST /api/internal/jobs/run`)
  that requires a secret header compared in constant time, refuses without it,
  and is never cached; and
- the scheduler that calls it, chosen and recorded in this ticket: a host cron
  entry on the VPS (owner, alongside the cutover, ticket ci-cd 08) or a
  scheduled GitHub Actions workflow. The secret lives in the production `.env`
  and, if used, a GitHub environment secret; never in the repo.

The jobs are already idempotent (predicated `updateMany` claims), so an
overlapping or repeated call is safe; keep it that way.

**Blocked by:** 20

**Status:** ready-for-agent

- [ ] The route runs `runScheduledJobs` only with the right secret; a missing or wrong secret gets 401 and runs nothing (tests for both)
- [ ] The response reports per-phase counts, never PII or secrets
- [ ] The scheduler choice is recorded here, and the owner-side step (cron line or secret) is written as a ready-for-human note in ci-cd 08's Comments
- [ ] CI green
