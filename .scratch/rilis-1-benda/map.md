# Map:\Product can do its job — every role, and money that actually moves

## Destination

A real donation enters, and the money reaches a Fundraiser's verified bank
account — and every role can do their job through the product rather than
through a database client. Reached when: one donation goes through donate →
Settlement → Payout → a real bank account, with the evidence the PRD promises
is public, and no step of that needs `psql`.

Every session orients to this before choosing a ticket.

**The destination, counted:** [scorecard.md](scorecard.md) measures every job in
the job descriptions against what a person can actually reach. As of
2026-09-27: Donor 5 of 5, Tim CSR 2 of 4, Verifier 6 of 8, Fundraiser 2 of 5,
Volunteer 0 of 5, **Admin 2 of 13**.
A screen does not count unless something points a person at it — a button, a
nav link, or a redirect. Ten of Admin's thirteen jobs are enforced in code and
unreachable by a person, which is why the money cannot move through the
product. The Volunteer module is unreachable at **both** ends, so a Volunteer
Trip can be created and never approved.

## Notes

- **Skills every session consults**: `grilling` and `domain-modeling` (always
  both), `research` for research tickets. Read `CONTEXT.md` and `docs/adr/`
  before deciding anything about money — ADR 0002, 0006, 0007 and 0011 all
  bear on it.
- **Workflow**: `AGENTS.md` — the coordinator dispatches, builders work in
  worktrees, money and security code always gets an independent review.
- **Standing preference**: prefer deciding a question over guessing. Three of
  the four findings this map was chartered from turned out to be
  non-questions that were left open, and the cost was code shipped around
  them.
- **The tracker's `done` is not trustworthy on its own.** A ticket has been
  found marked `done` while its PR was unmerged. When a decision depends on
  "is this shipped", check the merge, not the status line.

### What this map was chartered from

Verified against the code, not the tracker. Each finding is developed in the
ticket it became.

Findings that shaped the tickets below, all verified against the code rather
than the tracker:

- **`BankAccount` cannot be created by anyone.** `bankAccount.create` does not
  exist anywhere in `src/`; the only writer is `prisma/seed.ts`. Payout demands
  `verifiedAt`, so a real Fundraiser has no way to set a destination.
- **No Admin panel for Payouts.** `approvePayout` and `completePayout` exist
  and enforce the two-person rule, but no screen in `src/app/admin` calls
  either. A Payout raised through the product stays PENDING.
- **Usage Report does not exist at all** — no model, no route. It gates "a
  Usage Report is required before the next Payout", the Campaign page's list
  of completed Payouts, and the beneficiary count on Impact.
- **There is no document upload.** §7.1 has eleven checklist rows and not one
  document behind them; a Verifier ticks a label. `/api/upload` accepts images
  only, writes to `public/uploads`, and has no access control.
- **Seven Admin API route groups have no screen at all** (counted on
  `origin/main` at `a1889fe`, 2026-09-28; the map previously said *eleven*,
  and `scorecard.md:120` had already recorded that eleven was too many without
  saying what the right number was): `reconcile`, `scrutiny`, `platform-fee`,
  `manual-contributions` (with `[id]/decision`), `abuse-thresholds`,
  `duplicate-similarity`, `provider-withdrawals`. The derivation, so the next
  session does not have to redo it: `find src/app/api/admin -name route.ts`
  returns 15 route files; `find src/app/admin -name page.tsx` returns 6 pages;
  three of those pages (`users`, `verification-checklist`,
  `partnership-inquiries`) are the only ones a route is called from, confirmed
  by grepping each route path and each route's nine underlying
  `src/lib/` functions for a non-test caller in `src/app` or `src/components`
  and finding none. The other three pages — the dashboard, `campaigns` and
  `collecting-entities` — are not callers of any of the seven. The rules are
  enforced in code and unreachable by a person.
- **Four components are complete, tested, and rendered nowhere**:
  `CampaignDetail.tsx` (with working Updates and Payout tabs), `ShareModal`,
  `CampaignPrayers`, `CampaignCTA`.

### Corrections to the findings above

Recorded because the map cites the findings as established. The findings are
left as written — they were true when this map was chartered, and rewriting
them would hide that they have to be re-checked.

- **"The Payout screen is blocked only by the absence of `bankAccount.create`"
  is incomplete. It has two blockers.** Verified per-byte on `origin/main` at
  `a1889fe`, 2026-09-28:

  - `Payout.bankAccountId` is **already required** — `prisma/schema.prisma:1684`,
    `bankAccountId String` with no `?`. (The line 1624 quoted elsewhere belongs
    to the coordinator's local `fe1983d`, which has not diverged from
    `origin/main`; the fact holds on both, the line number does not travel.)
  - The payout API **already demands it** —
    `src/app/api/campaigns/[slug]/payouts/route.ts:10`,
    `bankAccountId: z.string().min(1, 'Rekening bank harus dipilih')`, and the
    same at `src/app/api/volunteer-trips/[slug]/payouts/route.ts:11`.
  - But **no `.tsx` in `src/` names `bankAccount` at all** —
    `grep -ril bankaccount --include="*.tsx" src/` returns 0 files. (Two files
    match the Indonesian word `rekening`, both static copy:
    `src/app/(static)/terms/page.tsx` and
    `src/app/(static)/faq/faq-accordion.tsx`. Neither is a picker.)

  So the schema and the API have long asked for a bank-account picker and no
  screen provides one. **Ticket 16 closes one of the two blockers, not the
  blocker.** Whoever schedules the Payout screen must schedule the picker too,
  or #114 stays unreachable after 16 lands. Developed in
  [16](issues/16-bank-account-create-and-verification.md).
- **"Eleven Admin routes have no screen" was too many** — it is **seven** route
  groups, derived above. `scorecard.md:120` had already flagged eleven as wrong
  but did not give the replacement number.

## Decisions so far

<!-- the index: one line per closed ticket, then zoom the link for the detail -->

- [06: Is a Refund capped per Kind, and which Kinds?](issues/06-refund-cap-per-kind.md):
  one uniform bound for `zakat` and `wakaf`, none for `hibah`, decided now —
  the number, the gate-or-observation question, and per-Kind configurability
  are all still open.
- [08: Does a Tim CSR get an account of its own?](issues/08-tim-csr-account.md):
  yes, and it is a term rather than an Assignment — no Campaign, no Payout, no
  Verification Request. Several people may share one company. Whether the
  account is anchored to the person or the company is still open, and so is
  whether a company is verified at all.
- [09: Is the Volunteer module in Release 1?](issues/09-volunteer-in-rilis-1.md):
  yes, with the rule that no half-open loop ships — a Trip that can be created
  must be approvable by a person, and a Volunteer who registers must reach a
  payment and a confirmation. The certificate, the quota warning, the Escrow
  Hold period and the lifecycle fork are all still open.
- [01: How does a Fundraiser get a bank account, and who says it is theirs?](issues/01-bank-account-verification.md):
  the owner adds it unverified on their own profile, and a Verification Request
  references it by id — approval sets `verifiedAt`. Checked once, not per
  Campaign; a Verifier may not check their own. Uniqueness stays unenforceable,
  so the account a Payout points at is the thing verified, and a Donor's Refund
  account uses the same flow. Two of the ticket's four questions turned out to be
  already answered by `CONTEXT.md` and ADR 0006.
- [10: If nobody requests a Payout, when is matured escrow released?](issues/10-escrow-release-without-a-payout-request.md):
  a non-question — Release 1 *does* ship a trigger, so the spec's wording about
  a second path stands and does not change. `f97c96e` gave `runScheduledJobs`
  its first caller. The residue is operational, not a decision: the secret and
  the host cron belong to the owner, in prd-compliance 45.

Tickets 02–05, 07, 11–15 and 17 were resolved together on 2026-09-28 in one batch grilling round (the owner answered "ya semua"); each answer is recorded in its own ticket.
- [02: Di mana saldo riil provider dicatat, apakah selisih itu gerbang?](issues/02-provider-balance-record.md): Gerbang: tolak approve bila saldo provider tercatat < Campaign Balance yang diminta, dengan opsi eksplisit Admin mencatat "sudah dicek, kurang" sebagai keputusan tertunda — FFI-07 menyebutnya pengganti API saldo yang…
- [03: Di mana dokumen yang diajukan tersimpan, siapa yang boleh melihat?](issues/03-documents.md): Object storage dengan signed URL berumur pendek (bukan `public/uploads` — gerbang keamanan, layak diprioritaskan walau bukan Fase 2 murni); Verifier + Fundraiser pemilik + Admin saja yang melihat, tautan kedaluwarsa;…
- [04: Apakah angka PRD default di kode, atau konfigurasi?](issues/04-numbers-code-or-config.md): Escrow Hold & threshold similarity tetap konstanta kode (jarang berubah, tak sepadan 2 halaman Admin sebelum Fase 2); Platform Fee tetap konfigurasi (mekanisme sudah ada, PRD minta override per Category/Campaign) —…
- [05: Apa yang dilihat orang yang memegang dua assignment sekaligus?](issues/05-two-assignments-one-person.md): Terima (1) — aturan dua-orang FFI-07 sudah menjaga uang lewat larangan per-transaksi "tidak atas subjek sendiri" (sudah ada di `payouts.ts`, dipakai lagi tiket 16). Tolak (2) — layar eksklusif menambah kompleksitas…
- [07: Siapa boleh memberi assignment ADMIN/VERIFIER, apakah dua-orang?](issues/07-granting-assignments.md): (a) pending-grant sederhana meniru pola `BankAccountVerificationRequest` yang baru dibangun tiket 16 — pola sudah ada, tak perlu desain baru; (b) perbaiki self-revoke agar menolak **kedua** assignment, perbaikan satu…
- [11: Apa yang mencabut verifikasi Bank Account, dan siapa yang boleh?](issues/11-clearing-a-bank-account-verification.md): (b) Verifier lain — simetris dengan aturan 16 "Verifier tak menilai rekeningnya sendiri"; dua aksi terpisah (cabut verifikasi ≠ Suspension); yang sudah cair tidak disentuh; reversibel dengan alasan tercatat, pola…
- [12: Di mana nomor Bank Account didekripsi, apa instruksi payout-nya?](issues/12-decrypting-a-bank-account-at-payout.md): Jawab (1) dulu: kalau provider aktif masih tanpa API pencairan, nyatakan eksplisit nomor tak pernah dibaca di payout, perbaiki komentar schema, tutup (2)-(3) sebagai "tidak berlaku sampai ada provider dengan API…
- [13: Apa yang dianggap bukti bahwa uang benar-benar berpindah?](issues/13-what-counts-as-proof-that-the-money-moved.md): Catatan teks terstruktur wajib sekarang (referensi transaksi + kalimat bebas, aturan `cleanProofReference`-style), artefak upload menyusul setelah 03. Tidak diblokir 03 untuk bagian ini — murni perubahan Zod + fungsi…
- [14: Sapuan melaporkan pengingat yang tak pernah terkirim?](issues/14-the-jobs-trigger-and-the-reminder-it-loses.md): Ganti nama field jadi `attemptedCount` (atau tambah `deliveredCount` dari boolean yang dibuang) — perubahan kecil, tak sentuh logika uang. Secret: terima risikonya, tak perlu rate limit sekarang — bukan gerbang Fase…
- [15: Bisakah sapuan escrow kelaparan di belakang baris yang tak pernah dilepas?](issues/15-the-escrow-sweep-can-starve.md): Lewati baris yang gagal karena guard permanen dengan urutan sekunder yang mendorongnya ke belakang jendela berikutnya (jangan ubah `escrowReleaseAt` — itu salah akuntansi); naikkan limit atau ubah kueri agar baris…
- [17: Pemilih rekening sudah ada di PR; daftar kosongnya tidak dimiliki siapa pun](issues/17-the-picker-exists-what-the-empty-list-does-not-do.md): (1) pasang tautan ke `/akun/rekening` di empty state sekarang, biaya rendah; (2) query pemilih tetap `verifiedAt: {not:null}`, tapi tambah kalimat pembeda di empty state ("belum pernah menambahkan" vs "ada yang…

## Open

<!-- the unanswered half: one line per ticket still waiting on an owner -->

Every ticket below is a **decision**, not a defect list — each one asks a
question only Dri can settle. None is written up as a fix, deliberately.

- [16: A person creates a Bank Account, and a Verifier is what verifies it](issues/16-bank-account-create-and-verification.md):
  the code for 01, in a fourth table rather than on a nullable
  `VerificationRequest.campaignId`. An unverified account with no request may be
  deleted; **an account may never be edited**, because the number is what a
  Payout points at. The Verifier sees the **full** number in the decide panel
  and a masked one in the list — a name can be checked without the number, a
  mistyped digit cannot. **This is #114's only blocker**: the account picker on the Payout form is
  already in that PR, along with the list it draws from.
  **`done`** — merged 2026-09-28 in PR #121 (`c19f2eb`), after independent
  Standards and Spec review; the Spec review's double-submit race was closed
  with a partial unique index (one PENDING request per account).
- [18: Which second payment provider carries VA, e-wallet and disbursement?](issues/18-second-payment-provider.md):
  research. Rilis 1 now includes the Fase 2 gate, which needs Payments from two
  providers reconciled; no second provider is named anywhere.

## Not yet specified

Fog, in coarse patches — sharp enough to know it is in scope, not yet sharp
enough to be a ticket:

- **Which of the seven missing Admin screens are Rilis 1 and in what order.**
  The list is known; the priority is not, and it depends on which decisions
  below land first.
- **What a person holding two assignments sees.** ADR 0005 removed rank, so
  "an Admin" is not a single thing. Which screens does a person with both
  ADMIN and VERIFIER reach? This shapes every page, and it is not yet clear
  whether it is one rule or several.
- **Whether the Fundraiser pages are complete even ignoring Payout.** There is
  no Campaign Update form in the dashboard, and §7.1's document upload has no
  home on that page either. Whether that is one ticket or two is not sharp
  until the document decision below resolves.
- **Whether FFI-16 (Donor privacy, currently nothing) belongs before or after
  the role pages.** §7.2 assumes an anonymised Donation cannot be refunded,
  and today no Donation can be anonymised, so the rule is vacuous rather than
  wrong. Whether to close that first is a product call.
- **The two numeric questions the PRD does not answer**: whether a Refund is
  capped per Kind and which, and whether the Rp50.000 waiver is a code default
  or Admin configuration. Both need a product answer, but neither blocks a
  decision on this map yet.

## Out of scope

PRD §6 excludes these deliberately. Ruled beyond the destination, and closed
unless the destination is redrawn:

- **Volunteer Trip and volunteer records** (FFI-11, FFI-12, release 3).
- **Two languages** (FFI-15, release 3).
- **Short sharing links**, **WhatsApp notifications**, **Donor-initiated
  refunds**, **automated provider-settlement import**, **accounts for
  organisational team members**.
- **Wallets and AutoDonation** — the code was removed, deliberately.
- **Mobile app, blockchain certificates, automatic volunteer matching,
  accounting-system integration, merchandise marketplace** — excluded with no
  schedule.
