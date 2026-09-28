# 14: The sweep reports a reminder it never delivered

**Type:** grilling

**Status:** resolved

## Question

`POST /api/internal/jobs/run` is the only thing that has ever called
`runScheduledJobs` (`src/app/api/internal/jobs/run/route.ts:51`), it is the
money-moving and email-sending entry point of the whole platform, and its
entire access control is one header: `x-jobs-secret`, compared by SHA-256 +
`timingSafeEqual` (`:30-33`). No rate limit, no lock. `grep -rni
"ratelimit|rate limit" src/` returns nothing anywhere in the codebase, so this
is not a house standard this route is below -- it is the first route to have to
answer the question.

The interesting half is smaller than it first looked, and the question is about
the *report*, not the delivery.

1. **The sweep's own count is a lie it tells its caller.** `sendReportingFailure`
   (`src/lib/mail/index.ts:100-126`) never throws. It catches, logs one JSON
   line, and **returns whether the provider accepted the message** -- that
   boolean is its whole return value. `sendCampaignDeadlineReminders` calls it
   at `src/lib/reminders.ts:128` and **discards the return**, then runs
   `sentCount++` at `:141` unconditionally. So a sweep in the middle of a
   mailer outage reports `sentCount: 500` and a 200 from the route, while 500
   emails were refused and logged as `mail_send_failed`. The one signal that
   would distinguish "we reminded them" from "we tried" is computed and thrown
   away, on the one path where an operator is deciding whether to resend by
   hand. Decide: does the result shape carry delivery at all, or is `sentCount`
   a claim count that the route response should stop calling `sent`?

2. **Is one bearer without a bound enough?** An unbounded caller moves no money
   and sends no second email -- the three phases are claim-idempotent -- so the
   honest answer is less alarming than it looks. What it does get is a free work
   amplifier on a public URL: every call runs a three-phase sweep including two
   `findMany`s of up to `REMINDER_SWEEP_LIMIT = 500` rows
   (`src/lib/reminders.ts:38, 82, 183`) and one `releaseMaturedEscrow` pass,
   with `Cache-Control: no-store` and `force-dynamic`. Decide whether a bound
   belongs here, and if so what kind, or accept the exposure because the secret
   is the whole gate and the host cron is the only legitimate caller.

## Notes

Surfaced 2026-09-28 while verifying the claim that the scheduled jobs are
idempotent, and **rewritten after that verification.** The first draft of this
ticket claimed the reminder was lost forever: that the claim commits before the
send, so a mailer failure would leave `deadlineReminderSentAt` committed and
the Fundraiser never told. Three of those steps are true and the conclusion is
false.

- The claim does commit before the send (`reminders.ts:99-115`, `:116`, `:128`).
  Correct.
- But the in-app Notification commits **in the same transaction as the claim**
  (`:105-114`), by explicit design. The comment at `:95-98` says why: "a
  failure partway through (e.g. the Notification write) rolls back the claim
  too, rather than marking a Campaign 'reminded' when it was never actually
  notified." So the Fundraiser *is* told, durably, on every path. The email is
  the best-effort channel, not the record.
- And the mailer cannot reach the outer `catch` at all. `sendReportingFailure`
  swallows. The `catch` at `:142` is reachable only from the database
  transaction, which rolls the claim back with it -- the safe case.
- The "nothing tests a mailer failure" claim was also false:
  `src/lib/reminders.test.ts:191-206` mocks the mailer to reject and asserts
  exactly this invariant, with a comment stating the design the first draft
  wanted to overturn.

The lesson worth keeping: `sendReportingFailure`'s own docstring says "a
decision already committed stands whether or not the email arrives". The code
is right and the first draft was reading past it. What the code does *not* do
is tell anyone, afterwards, which of those decisions reached an inbox.

The money claim holds and was checked. `releaseMaturedEscrow` claims each
Payment with a predicated `updateMany` on `escrowReleasedAt: null` under the
Campaign row lock, so no rupiah is released twice however many times the route
is called. Both reminder sweeps use the same claim pattern. That part of the
original premise does not survive contact with the code either.

What remains untested is narrower: prd-compliance 45's HTTP-seam tests check
three *sequential* authorised calls, one reminder each. Nothing exercises two
*concurrent* runs. That gap is real but belongs to 45, not here.

Not a duplicate of 45, which is `ready-for-human`: the code it asked for is
written and green, and what remains is the owner's cron line and `JOBS_SECRET`.
This ticket is about a property of the code that shipped under it. Nor is it
[10: If nobody requests a Payout, when is matured escrow
released?](10-escrow-release-without-a-payout-request.md), which asks whether
Rilis 1 ships a scheduler at all.

## Answer

Owner (Dri), 2026-09-28, in the batch grilling round
([grilling-borongan-2026-09-28.md](../grilling-borongan-2026-09-28.md)),
answered "ya semua": the recommendation stands as the decision.

Ganti nama field jadi `attemptedCount` (atau tambah `deliveredCount` dari
boolean yang dibuang) — perubahan kecil, tak sentuh logika uang. Secret:
terima risikonya, tak perlu rate limit sekarang — bukan gerbang Fase 2, murni
kebersihan pelaporan.
