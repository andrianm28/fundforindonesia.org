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

**Status:** ready-for-human (the code is in; the scheduler itself is a host step, see Comments)

- [x] The route runs `runScheduledJobs` only with the right secret; a missing or wrong secret gets 401 and runs nothing (tests for both)
- [x] The response reports per-phase counts, never PII or secrets
- [x] The scheduler choice is recorded here, and the owner-side step (cron line or secret) is written as a ready-for-human note in ci-cd 08's Comments
- [ ] CI green (full suite and the ratchet are the coordinator's step, not this ticket's)

## Comments

- 2026-09-27: `POST /api/internal/jobs/run` added
  (`src/app/api/internal/jobs/run/route.ts`). It is the first and only caller
  `runScheduledJobs` has ever had. The secret is `JOBS_SECRET` from the
  production `.env`, presented as the `x-jobs-secret` header; both sides are
  SHA-256'd and compared with `timingSafeEqual`, so a wrong-length value is
  compared as a whole digest instead of being rejected on length. An
  **unset** `JOBS_SECRET` refuses everything (503) rather than running
  unauthenticated -- this is a route that moves money and sends email on a
  public URL, and "no secret configured" must never mean "no auth required".
  `force-dynamic` plus `Cache-Control: no-store`, like `/api/health`.

  Nine tests at the HTTP seam (`route.test.ts`), mocking only the two system
  boundaries (prisma, the mailer) so the real sweeps run: 401 and runs
  nothing for a missing and for a wrong secret; 503 and runs nothing when
  unconfigured; per-phase counts in the response; the response body contains
  no secret, email, name or title; the release really posts the two
  `escrowReleaseLegs`; and three authorised calls in a row move money once
  and send one reminder each, with a not-yet-matured hold left in escrow.

- 2026-09-27: **Scheduler choice: a host cron entry on the production VPS.**
  A scheduled GitHub Actions workflow was the alternative and was rejected for
  three reasons specific to this job: the runs would depend on GitHub Actions
  being up and on the runner's schedule as much as on the app, GitHub
  disables scheduled workflows in a repository after 60 days without
  activity, and a delayed or dropped run delays matured escrow -- money a
  Fundraiser is owed. A host cron line runs beside the database, and the
  secret never leaves the host's `.env`. Neither choice lives in the repo:
  both are owner-side configuration, and an agent may not take either.

  **This is what the owner has to do; the code is done and idle until it is.**
  Per ci-cd 08, the owner runs these on the host, at the cutover:

  1. In the production `.env`, add `JOBS_SECRET` (generate with
     `openssl rand -base64 32`). Never in git.
  2. Install one cron entry, reading that value from the `.env` so the secret
     is not on the crontab line itself:

     ```cron
     */15 * * * * . "$DEPLOY_DIR/.env" && curl -fsS -X POST -H "x-jobs-secret: $JOBS_SECRET" http://127.0.0.1:8093/api/internal/jobs/run >> "$DEPLOY_DIR/logs/jobs.log" 2>&1
     ```

     Every 15 minutes, so a matured hold becomes withdrawable within a
     quarter of an hour of maturing. The port is the app container's, the
     same one `/api/health` is polled on (ci-cd 04, 07).
  3. Deploy the release that contains the route, then confirm it by hand once
     -- a 401 means the secret does not match, a 200 with per-phase counts
     means it ran:

     ```sh
     . "$DEPLOY_DIR/.env" && curl -sS -X POST -H "x-jobs-secret: $JOBS_SECRET" http://127.0.0.1:8093/api/internal/jobs/run
     ```

     Repeating that call is safe and is the intended check: the second call
     reports zeros and moves nothing.

- 2026-09-27: a false claim corrected rather than left standing. The entry
  point's own doc comment said the escrow phase "makes the 7-day hold let go
  of money whether or not a Fundraiser ever asks for a Payout". That was
  false -- nothing called `runScheduledJobs` at all, so a matured hold was
  released only when its own Fundraiser requested a Payout, and both
  reminder sweeps sent nothing in production. `src/lib/scheduled-jobs.ts`
  now names the route as the only caller and says plainly that the sweep
  does nothing until a human installs the scheduler. The same overstatement
  still sits in `src/lib/money/escrow.ts` (its "There is no scheduler
  anywhere in this repo" paragraph), which another ticket owns; it was left
  alone here.

- 2026-10-04 (percepatan-full-rilis, Track D): status **tetap** `ready-for-human`. Cron belum dipasang di produksi: pemasangannya menunggu tiket `reminders-skip-demo-campaigns` ter-deploy, karena 8 Campaign demo akan memicu pengingat tenggat begitu `POST /api/internal/jobs/run` berjalan. Setelah deploy itu, pasang cron, panggil dua kali dengan tangan (200 dengan hitungan, lalu nol), baru tutup tiket ini. Tiket `reminders-skip-demo-campaigns` ditulis koordinator di batch tiket baru.
