# 28: Permukaan pengingat Kind Authorisation

**Type:** implementation

**Status:** done

**Blocked by:** —

## Why

Pengingat 30 hari Kind Authorisation sudah 🟡: kode+tes ada, belum
dikonfirmasi dipanggil job terjadwal atau ditampilkan di layar mana pun.
Satu dari empat item Q9. Owner 2026-09-28
(`prd-audit/triage-2026-09-28.md` Bagian A, Q9): `rilis-1-benda`, lajur L2,
satu tiket per layar.

## Decision / scope

Konfirmasi (atau sambungkan) pemanggilan job terjadwalnya, dan beri
permukaan yang terlihat Verifier/Admin: daftar Kind Authorisation yang akan
atau sudah lewat tanggal.

## Implementation note

- **Job wiring, confirmed, no code change.** On the base `origin/main` at the
  time of this ticket, `POST /api/internal/jobs/run` calls `runScheduledJobs`,
  whose third phase is `sendKindAuthorisationExpiryWarnings`. Already pinned
  by `src/lib/scheduled-jobs.test.ts` and `src/app/api/internal/jobs/run/route.test.ts`
  (repeat: `rg -n 'sendKindAuthorisationExpiryWarnings' src/`). What is not in
  the repo is the scheduler that calls the route (host cron, owner's step in
  ci-cd-github-actions ticket 08 / prd-compliance 45); until it is installed the
  warning is never sent. I did not add a workflow: that is the owner's choice.
- **Surface.** New Verifier page `/moderasi/kind-authorisations`
  (`src/app/moderasi/kind-authorisations/page.tsx`, `force-dynamic`, VERIFIER
  gate like its neighbours) lists Kind Authorisations expiring within 30 days
  or already past, lapsed first. The rule is the pure
  `kindAuthorisationsNeedingRenewal` (`src/lib/kind-authorisation-renewal.ts`);
  it leaves out a past authorisation that a later one of the same Kind for the
  same organisation already replaces, since authorisations are never deleted.
  Nav link added to the sidebar and mobile bar of `src/app/moderasi/layout.tsx`,
  with a test in `layout.test.tsx`. The page is registered in
  `roles-expand-guard.test.ts` (it reads `Assignment.VERIFIER`).
- The Moderasi dashboard's existing "Izin Akan Berakhir" card is unchanged; it
  covers upcoming expiry only, and not lapsed ones.
- No edits to `reminders.ts` or `scheduled-jobs.ts`, so no conflict with ticket
  14's `sentCount` rename.

- **Who sees it (owner decision, 2026-09-29, review of PR 140).** Verifier
  only, on purpose. The ticket's "Verifier/Admin" was read as the Verifier
  side of the platform operator; an Admin-only person does not get a second
  surface, since Admin and Verifier are independent assignments (ADR 0005) and
  acting on a Kind Authorisation is the Verifier's job. Revisit only if an
  Admin-only operator turns out to need the list.
- **Review follow-ups.** The 30-day window is one constant
  (`src/lib/kind-authorisation-window.ts`) shared with the reminder, and the
  renewal rule has boundary tests (exactly 30 days is expiring; exactly now is
  lapsed).
