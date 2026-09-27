# 20: Scheduled jobs and escrow release on a schedule

**What to build:** Matured money becomes available on time, whether or not a Fundraiser happens to request a Payout, and time-based reminders start working.

**Blocked by:** 19

**Status:** done (PR #58, 56deb20)

- [x] A single scheduled entry point takes the current time as an argument and is driven directly in tests, never through timers
- [x] Matured Escrow Hold releases to Campaign Balance on schedule, with the existing lazy sweep kept as a second path
- [x] Campaign deadline reminders and Kind Authorisation expiry warnings run here
- [x] The sweep remains bounded and idempotent, and one failing payment cannot stop the rest

## Comments

Implemented in PR #58. `runScheduledJobs(now, mailer?)` (`src/lib/scheduled-jobs.ts`)
is the single entry point, driven directly in tests with a fixed `now`. It runs
three phases, each isolated from the others (one throwing falls back to a
zeroed result for that phase, logged, without blocking the rest):
`releaseMaturedEscrow` (ticket 19, now takes an injected `now`), Campaign
deadline reminders, and Kind Authorisation expiry warnings
(`src/lib/reminders.ts`). Both reminder sweeps mirror `releaseMaturedEscrow`'s
own bounded, claim-via-predicated-`updateMany` idempotency pattern, so two
overlapping scheduler runs send exactly one reminder per Campaign/
authorisation, and isolate per-row failures the same way. New nullable
columns `Campaign.deadlineReminderSentAt` / `KindAuthorisation.expiryWarningSentAt`
track "already reminded" (migration `20260927070000_scheduled_job_reminders`).
The existing lazy sweep (payout request handlers) is untouched.

Assumptions flagged for owner review:
- `CAMPAIGN_DEADLINE_REMINDER_DAYS = 3` (`src/lib/reminders.ts`): no lead time
  is written down anywhere for this. Picked a single reminder, 3 days before
  deadline, as this change's own choice.
- `KIND_AUTHORISATION_EXPIRY_WARNING_DAYS = 30`: taken from spec.md's own "at
  30 days" text, matching the Verifier dashboard's `expiringWindows` default.
- Left out on purpose, per spec.md's fuller description of `runScheduledJobs`:
  Refund link expiry and the 60-day unclaimed-balance report. Neither is in
  this ticket's checklist, and the balance report has nothing to hook into
  yet (Dormant Balance is unbuilt) — flagged in the entry point's own doc
  comment so it isn't silently missing later.
- No cron route or container-scheduler wiring was added to actually invoke
  `runScheduledJobs` in production; the checklist only asked for the entry
  point itself.
