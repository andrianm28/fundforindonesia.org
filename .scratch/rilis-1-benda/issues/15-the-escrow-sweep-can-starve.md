# 15: Can the escrow sweep starve behind rows it will never release?

**Type:** grilling

**Status:** in-review

## Question

`releaseMaturedEscrow` reads its work list with `orderBy: { escrowReleaseAt:
'asc' }` (`src/lib/money/escrow.ts:181`), `escrowReleasedAt: null` (`:157`) and
`take: ESCROW_RELEASE_SWEEP_LIMIT` (`:182`). `ESCROW_RELEASE_SWEEP_LIMIT` is
200 (`:52`). Oldest matured hold first, and deliberately so: the comment at
`:178-180` says the ordering exists so that if the limit truncates the list,
"which holds get left for the next call is deterministic rather than whatever
order the database happens to return".

Some of the rows that sweep reads are then **skipped**, and the skip is not
always temporary. Two guards `return false` after the list is already in hand:

- **`:242`** -- `isEscrowReleaseFrozen(subjectState)`, the rule that keeps a
  **SUSPENDED** Campaign's matured money in Escrow Hold until the Suspension is
  lifted. A Suspension that is never lifted leaves this row eligible forever and
  released never.
- **`:271`** -- `hasRefundInFlight`, a Refund in `REQUESTED` or `PROCESSING`. A
  Refund left open defers the Payment for as long as it stays open.

Both paths leave `escrowReleasedAt` null and `escrowReleaseAt` in the past. So
the row is *still eligible* on the next call, and — because it is still the
oldest — it sorts to the **very front** of the next call's list too. Nothing in
the query tells a row that was skipped for a moment apart from a row that has
been skipped for a year.

**Which means the 200-row window can be filled entirely with rows the sweep
cannot use.** Once 200 such rows exist, every call reads the same 200, releases
none of them, and the money that genuinely matured behind them is never read at
all. Not degraded: stopped. And the caller is told nothing, because the
`matured.length === ESCROW_RELEASE_SWEEP_LIMIT` warning at `:185-194` still
fires and still says "more matured holds remain and will be picked up by a later
call" — which is the one thing that is not going to happen.

**This is not a silent loss, and that is worth being precise about.**
`deferredEscrowWatchdog` (`src/app/api/admin/reconcile/route.ts:63-81`) reports
exactly these Payments, and each entry carries a `cause` — `'SUSPENDED'` for the
frozen case, nothing for the stuck-refund case — so the reconciler never presents
them as unexplained. But the watchdog reports **per subject**. It says "this
Campaign is suspended and its money is held", and it never says "the sweep that
is supposed to release every *other* Campaign's matured money has stopped
reaching them". An operator reading a list of suspended Campaigns learns nothing
about the full window sitting behind that list. The reconcile report has no
screen yet either — a patch of fog the map already records.

**The number 200 decides whether any of this is theoretical.** It takes 200
simultaneously-suspended Campaigns, or 200 Payments whose Refunds are all stuck
open, before the sweep stops outright. That is rare. It is also the kind of rare
that nothing is paged for, and it is reached by accumulating rather than by
anything sudden.

One scoping detail, because it changes how far the damage reaches: the two
Payout routes call this subject-scoped (`payouts/route.ts:62` for a Campaign,
`volunteer-trips/[slug]/payouts/route.ts:60` for a Trip), and the query then
narrows to that one subject (`:158-159`). A single stuck Campaign can therefore
starve only itself on those paths. It is the unscoped call from
`src/lib/scheduled-jobs.ts:72` that the 200 rows are shared across, and that is
the one that can starve everyone.

Three questions that have to be answered together:

1. **Should the sweep move past a row it cannot release?** A hold that matured
   and cannot be released is not the same as a hold that has not matured, and
   the query reads them alike. If the answer is yes, two consequences have to be
   named with it: what bounds the skipping, and whether a later call sees the
   rows this one stepped over or only the rows it did not read at all.
2. **Is 200 defensible *because* the watchdog exists?** The case for leaving it:
   a starved sweep is not an invisible one — every deferred Payment is listed,
   with a cause. The case against: the watchdog is per-subject and the failure
   is not, so what the owner actually reads describes held money and never a
   stopped sweep. Does the watchdog's coverage make the bound acceptable on its
   own, or are these one decision rather than two?
3. **Should the bound go up, and should the warning change?** 200 is described
   in the code as paying for "a bounded slice of the backlog; it does not
   promise to drain it" (`:50`) — a promise about work done, not about progress
   made. If the answer to 1 is no, then 200 rows of permanent deferral is a hard
   ceiling and the question is what the number should be. And either way: a
   warning whose text promises a later call that will never arrive is itself
   wrong, so what should it say when the window was full and every row in it was
   skipped?

## Notes

Surfaced 2026-09-28 by a read-only pass over the sweep while checking what
[10: If nobody requests a Payout, when is matured escrow
released?](10-escrow-release-without-a-payout-request.md) left behind, and
verified against the code: the `take` and its constant, the `orderBy`, the two
`return false` guards and their line numbers, the warning's condition and text,
the three live callers, and the watchdog's own description of itself in
`reconcile/route.ts`. Every claim above is a read of current `main`, not of a
diff.

The two guards are **not** the defect, and this ticket does not question them. A
Suspension holding matured money is `CONTEXT.md`'s Escrow Hold working as
specified, and a Refund in flight holding a Payment is a Donor still owed. Both
say `return false` deliberately. What is in question is only what happens to
every *other* Payment that the sweep never reaches because of them.

Not a duplicate of 10: that ticket asked whether Release 1 ships a trigger at
all, and closed on the grounds that it does (`f97c96e` gave
`runScheduledJobs` its first caller). This asks what the sweep that trigger now
runs does when its work list fills with rows it cannot act on — a property of
the code that shipped under 10, and one that exists whether or not the host cron
is ever installed. If the cron is never installed, this never fires, which is
not a reason to defer the question: 45 is `ready-for-human` and this is not.

## Answer

Owner (Dri), 2026-09-28, in the batch grilling round
([grilling-borongan-2026-09-28.md](../grilling-borongan-2026-09-28.md)),
answered "ya semua": the recommendation stands as the decision.

Lewati baris yang gagal karena guard permanen dengan urutan sekunder yang
mendorongnya ke belakang jendela berikutnya (jangan ubah `escrowReleaseAt` —
itu salah akuntansi); naikkan limit atau ubah kueri agar baris macet tak
memblokir yang lain; ubah teks peringatan agar membedakan backlog normal vs
baris macet permanen. Bukan gerbang Fase 2 murni — boleh menyusul setelah
02/11/12/13, tapi jangan didiamkan.

## Implementation note

**Rework (2026-09-30), owner memilih opsi (b): penanda yang tersimpan lintas
panggilan**, menggantikan draf pertama (cursor dalam-satu-panggilan saja,
lihat riwayat git untuk draf itu) supaya perbaikan mengikuti teks jawaban
secara literal, bukan hanya efeknya.

Kolom baru `Payment.escrowSweepDeferredAt` (nullable `DateTime`, migrasi
`20260930090000_escrow_sweep_cursor`, indeks
`(escrowSweepDeferredAt, escrowReleaseAt, id)`) adalah penanda sekunder itu.
`null` berarti "belum pernah dilewati guard permanen" -- keadaan setiap baris
lama, tanpa backfill. `releaseMaturedEscrow` (`src/lib/money/escrow.ts`)
mengurutkan kandidat `escrowSweepDeferredAt asc nulls first, escrowReleaseAt
asc, id asc`: baris yang belum pernah dilewati selalu di depan; di antara
baris yang pernah dilewati, yang paling lama dilewati di depan (rotasi adil).
`escrowReleaseAt`/`escrowReleasedAt` sama sekali tidak disentuh oleh
mekanisme ini -- tetap murni bacaan akuntansi seperti sebelumnya.

Saat guard permanen (`isEscrowReleaseFrozen`/`hasRefundInFlight`) melewatkan
sebuah baris, id-nya dikumpulkan (`permanentlySkippedIds`), lalu **satu
`updateMany` batch** menstempel `escrowSweepDeferredAt = now` untuk semuanya
**setelah seluruh scan-baca panggilan itu selesai** -- bukan satu per satu di
tengah scan. Alasannya konkret, bukan gaya: mengubah kolom yang JUGA jadi
kunci urut di tengah scan yang sama akan mengubah urutan baris yang belum
dibaca relatif terhadap cursor `id`, sehingga cursor bisa melompati baris
yang justru belum diproses (bug ini ditangkap oleh test regresi lama sendiri
saat draf ini pertama ditulis dengan stempel per-baris). Saat baris akhirnya
benar-benar dirilis, `escrowSweepDeferredAt` dibersihkan kembali ke `null`
dalam `updateMany` klaim yang sama (predikat `escrowReleasedAt IS NULL`
tetap satu-satunya yang menjaga keamanan-race klaim; field tambahan ini
hanya ikut ditulis oleh pemenang klaim) -- pilihan: **dibersihkan**, bukan
dibiarkan, supaya baris yang pernah macet lalu selesai terbaca identik
dengan baris yang tak pernah macet sama sekali.

Paging dalam-satu-panggilan (cursor `id`, `ESCROW_RELEASE_SWEEP_SCAN_LIMIT`)
dari draf pertama **dipertahankan** di atas rotasi ini, bukan dihapus:
keduanya menyelesaikan masalah berbeda. Rotasi lintas-panggilan adalah yang
membuat kelaparan mustahil untuk **berapa pun** jumlah baris macet permanen
(dibuktikan test baru: baris macet lebih banyak dari
`ESCROW_RELEASE_SWEEP_SCAN_LIMIT` sendiri, baris releasable tetap tercapai
dalam 2 panggilan). Paging dalam-panggilan adalah kenyamanan di atas itu --
membiarkan satu panggilan mencapai baris releasable yang duduk tepat di
belakang barisan macet, alih-alih menunggu rotasi bekerja lewat beberapa
panggilan.

`console.warn` tetap membedakan dua kasus seperti draf pertama: kuota rilis
terpenuhi (`releasedCount === ESCROW_RELEASE_SWEEP_LIMIT`, backlog normal)
vs batas scan tercapai tanpa kuota rilis terpenuhi (backlog didominasi baris
macet permanen, pesan menyatakan eksplisit "the sweep is not reaching the
rest of the backlog" dan menunjuk `deferredEscrowWatchdog`). Ditambah
komentar presedensi (`if`/`else if`, bukan dua kondisi independen) sesuai
nit review.

Regresi diverifikasi: test baru "reaches a releasable Payment behind MORE
permanently-stuck Payments than any single call's scan budget" (lebih dari
`ESCROW_RELEASE_SWEEP_SCAN_LIMIT` baris macet) membuktikan rotasi lintas
panggilan, bukan sekadar cursor dalam-panggilan, yang menutup starvation.
Test warning menutup kedua cabang peringatan (backlog normal dan
backlog-macet-dominan) plus kasus tanpa peringatan sama sekali. Mock test
(`escrow.test.ts`) diberi catatan eksplisit: ia meniru urutan/cursor/nulls
Prisma di atas array in-memory, bukan menjalankan Prisma/Postgres
sungguhan -- migrasi sendiri (`npm run ci:local -- migrations`) yang
membuktikan kolom dan indeks nyata berlaku bersih.

Tak ada perubahan pada `escrowReleaseAt`/`escrowReleasedAt` atau semantik
guard mana pun; klaim `updateMany` berpredikat tetap satu-satunya penjaga
race-safety pelepasan. Kanari `platformFeePortionFor` tetap 3 pemanggilan,
`requireRefundAllowedForKind` 3, `BankAccountNotEligibleError` 6. Tak ada
`as any`.

Verifikasi: `npx vitest run src/lib/money/escrow.test.ts
src/lib/scheduled-jobs.test.ts src/app/api/admin/reconcile/route.test.ts`
(93 lolos), `npx tsc --noEmit` (47, baseline, tak satu pun di file yang
diubah), `node ci/ratchet.mjs` (lint 193 baseline, tsc 47 baseline, keduanya
unchanged), `npm run ci:local -- migrations` (migrasi berlaku bersih dan
cocok dengan schema.prisma; satu kegagalan lokal-saja yang sudah diketahui
di `ledger-transaction-claim-migration.test.ts`, diabaikan sesuai arahan).
Full suite sengaja tidak dijalankan (builder lain memakainya).
`git diff --name-only origin/main HEAD` menyentuh `prisma/schema.prisma`,
`prisma/migrations/20260930090000_escrow_sweep_cursor/migration.sql`,
`src/lib/money/escrow.ts`, `src/lib/money/escrow.test.ts`, dan file tiket
ini.
