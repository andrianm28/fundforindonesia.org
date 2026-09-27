# Scorecard: is each role's job reachable through the product?

Written 2026-09-27, after `CONTEXT.md` gained a job description for all four
roles. The map's destination says "every role can do their job through the
product". This file is that sentence, counted.

## The measure, and why it is not the same as "a page exists"

A screen **does not count** unless something points a person at it: a button, a
nav link, or a redirect. A route that only an API client calls is unreachable
by definition. This repo already has eleven Admin routes enforced in code that
no person can reach, and four components that are complete, tested, and
rendered nowhere.

Every row below was read from the code, and every surprising one was re-checked
by the coordinator before being written down.

## The score

| Role | Jobs | Reachable | Code but no screen | No code at all |
| --- | --- | --- | --- | --- |
| **Donor** | 5 | 5 (one leaks) | 0 | 0 |
| **Verifier** | 5 | 4 | 1 | 1 |
| **Fundraiser** | 5 | 2 | 4 | 2 |
| **Admin** | 13 | 2 | 10 | 1 |

Donor is the only role that can do its whole job through the product. Admin has
thirteen jobs and can reach two of them. That is the destination, counted.

## Donor — 5 of 5, with a leak

| Job | State |
| --- | --- |
| Berdonasi tanpa wajib akun | reachable — `/campaign/[slug]/donate`; `isGuest` from session status, email required only for guests |
| Membaca Receipt | reachable — `/receipt/[token]`, linked from `/donasi-saya` and from email |
| Mengirim ulang Receipt | reachable — `ReceiptView.tsx:86`; gated on the token alone, so a Guest Donor can too |
| Mencetak Receipt | reachable — `ReceiptView.tsx:80`, `window.print()` |
| Melihat riwayat Donation | reachable for signed-in; a **Guest Donor has no history at all** (ticket 23, `ready-for-agent`) |
| Menyembunyikan identitas | reachable at creation — checkbox writes `isAnonymous` |

**The leak.** `src/app/receipt/[token]/page.tsx:43` passes
`donation.donor?.name ?? donation.guestName ?? null` with no `isAnonymous`
branch, and `ReceiptView.tsx:53` prints it. **An anonymous donation still
prints the donor's real name** on the receipt they can re-send and print. The
schema knows this: the comment at `prisma/schema.prisma:883` says `guestName`
follows the same `isAnonymous` rule as a registered donor's name. The rule was
written down; the receipt does not implement it.

This is inside ticket 21, which is marked `done` with a green PR. A ticket that
is `done` will never be reopened on its own, so this is invisible to the
tracker.

**One word, two jobs.** "Menyembunyikan identitas" covers both hiding at the
moment of donating (works) and anonymising a record afterwards on request
(FFI-16, zero code, ticket 36). They are different work with different
consequences, and the glossary entry now names only the first.

## Verifier — 4 of 5

| Job | State |
| --- | --- |
| Meloloskan / menolak Campaign | reachable — `/moderasi/campaigns/[id]`, a required reason blocks approval |
| Memverifikasi identitas Fundraiser | reachable but weak — it is a side effect of first approval (`campaign-lifecycle.ts:948`), not a standing action, and there is no list of verified identities |
| Menilai Petunjuk Duplikat | reachable — the "Campaign yang Mirip" panel, verdict stored as a checklist tick |
| **Memasang Flag** | code exists, **no screen** — `POST /api/campaigns/[slug]/flags`; the only mention in the UI is a sentence of prose |
| **Memeriksa rekening tujuan** | **no code at all** — `bankAccount.create` exists nowhere in `src/`; `verifiedAt` is written only by `prisma/seed.ts:451` |

The last row is ticket 01. The glossary has assigned that job to the Verifier
all along, and it was never read as a measure of anything.

## Fundraiser — 2 of 5

| Job | State |
| --- | --- |
| Menyusun Draft Campaign | reachable — `/campaign/create`, three steps, saves a draft. **But there is no edit form**: `PATCH /api/campaigns/[slug]` has no caller in any `.tsx` except the dead `CampaignDetail.tsx`, so a wrong draft can only be abandoned |
| Mengajukan Verification Request | reachable — "Ajukan ke Verifier" and "Tarik pengajuan" from the dashboard |
| **Mempertahankan Verification Request** | code exists, **no screen** — the API returns only a status badge; the reason for a rejection is stored and never shown to the Fundraiser |
| **Menulis Campaign Update** | code exists, **no screen** — the route is Fundraiser-gated and no `.tsx` calls it; the "Kabar Terbaru" tab at `CampaignDetailView.tsx:330` is a `<button>` with no `onClick` |
| **Mengajukan dan memantau Payout** | route exists; the screen is in unmerged PR #94. Nothing in `main` links to it |
| **Dokumen Campaign** | **no code** — no field, no model, no upload |
| **Usage Report** | **no code** — zero hits in `src/` and `prisma/` |

Five jobs, two reachable, and a fourth of the work has no model at all.

## Admin — 2 of 13

| Job | State |
| --- | --- |
| Mengelola peran pengguna | reachable — `/admin/users`, a checkbox per assignment. The *rule* is undecided (ticket 07) and `AssignmentAuditEntry` is written but read nowhere |
| Menyusun checklist dokumen | reachable — `/admin/verification-checklist`, including reordering |
| **Menyetujui Payout** | code exists, **no screen**. Also: no screen for the completing step, which is what actually moves the money |
| **Melihat rekonsiliasi** | code exists, **no screen** |
| **Memutuskan / mencabut Suspension** | code exists, **no screen** |
| **Menyetujui Cancellation** | code exists, **no screen** |
| **Menandai Campaign Completed** | code exists, **no screen** |
| **Memasang / melepas Urgent** | code exists, **no screen** |
| **Menyetujui Refund** | code exists, **no screen** |
| **Mencatat Manual Contribution** | code exists, **no screen** — PR #75 shipped the rule with no way to reach it |
| **Menyelesaikan Payout** — the step that actually moves the money | code exists, **no screen** |
| **Menolak Refund** | **no code** — `refunds.ts` exports `createRefund` and `approveRefund` and never produces a status other than `APPROVED` |
| **Membuat rekap keuangan** | **no code**, and no definition anywhere |

Ten of thirteen are enforced in code and unreachable by a person. This is the
single largest gap in the release, and it is the one the money depends on:
**a Payout raised through the product cannot be approved by anyone through the
product.**

### Two panel-wide findings

- **Neither panel has a door.** Nothing in `DesktopHeader` or `BottomNavBar`
  links to `/admin` or `/moderasi`. Both are reachable only by typing the URL.
  A person with the assignment still cannot find the work.
- **A dead link in the Admin shell.** `/admin/campaigns/page.tsx:112` points at
  `/campaign/[slug]/edit`, which does not exist.

## Corrections to what the map and the coordinator believed

Recorded because the map cites these as established:

- **"Eleven Admin routes have no screen" was too many.** `users/[id]/assignments`
  and `verification-checklist/[id]` (with `move`) *are* reached from
  `/admin/users` and `/admin/verification-checklist`. `partnership-inquiries/[id]`
  is reached from the list page.
- **"The Payout screen is a fifth dead component" was wrong.** There is no Payout
  screen in `main` at all. The screen exists in unmerged PR #94, where it is
  linked. The problem is the merge, not a dead component.
- **A partnership inquiry is never acknowledged to the company.** The form's
  email goes to `partnershipTeamRecipient()` — the platform team — with the
  company's address as plain text and no `replyTo`. The company receives
  nothing. The `/admin/partnership-inquiries/[id]` link in that email 404s, but
  only for the platform team, so its blast radius is small.

## What needs a human, and cannot be measured

- **"Mempertahankan Verification Request"** has three readings: revise a draft
  and resubmit, chase the status, or keep the paperwork valid. Three different
  tickets come out of the three readings.
- **"Membuat rekap keuangan"** is one sentence in the PRD and nothing
  anywhere else. A period report for a supervisor, a dormant-balance list, or a
  platform-fee summary per Kind are all defensible readings.
- **Which of the ten unreachable Admin screens are Rilis 1, and in what order.**
  The list is known; the priority is not, and it depends on tickets 01 and 07.
