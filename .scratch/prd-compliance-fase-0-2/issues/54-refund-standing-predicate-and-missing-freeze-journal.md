# 54: Satukan predikat "Refund masih berdiri" dan pemeriksaan jurnal freeze yang hilang

**Status:** ready-for-agent

**Blocked by:** none (49-53 done)

Refactor tanpa perubahan perilaku, dicatat dari review PR #207 dan #208.

- Predikat "Refund masih berdiri" (status di luar REJECTED/FAILED) kini ditulis
  ulang di beberapa tempat: `src/lib/money/escrow.ts`, `src/lib/money/impact.ts`,
  `src/lib/money/refunds.ts`, dan `src/app/api/admin/reconcile/route.ts`. Tiket
  51 dan 52 sama-sama lahir karena salah satu salinan tertinggal ketika status
  REJECTED/FAILED mulai ditulis (tiket 49).
- Pemeriksaan "jurnal freeze hilang" ada di tiga salinan (`refunds.ts` dua kali,
  `escrow.ts` sekali). Jalurnya tidak terjangkau dalam praktik (setiap Refund
  dibuat bersama freeze-nya dalam satu transaksi), tetapi kini melempar `Error`
  biasa (500 ter-log) atau `InvalidRefundStatusError` yang menyesatkan.

- [x] Satu predikat bersama untuk "Refund masih berdiri", dipakai semua pembaca
- [x] Satu helper untuk membaca jurnal freeze yang melempar satu error domain
      yang jujur bila jurnal tidak ada
- [x] Tidak ada perubahan perilaku selain error jurnal hilang; tes yang ada hijau, 4 diubah (lihat Comments)

## Comments

- 2026-10-03: owner menyetujui pengerjaan ("ya semua").
- 2026-10-03, `claude/prd-54-refund-standing-predicate`: `src/lib/money/refund-standing.ts` memegang `isRefundStanding`, `STANDING_REFUND_WHERE`, dan `readRefundFreezeEntries` (melempar `RefundFreezeJournalMissingError`, kode `REFUND_FREEZE_JOURNAL_MISSING`, HTTP 500 di `domain-errors.ts`). Dipakai `escrow.ts`, `impact.ts`, `refunds.ts` (createRefund, standingRefundFees, approveRefund), dan `reconcile/route.ts`. Tes baru: `refund-standing.test.ts`. Full suite hijau, ratchet lint 193 / tsc 19.
- Tes yang diubah (keputusan koordinator, bukan owner), hanya ini: (1) `refunds.test.ts` "refuses to approve a Refund whose freeze journal is missing": kini mengharapkan `RefundFreezeJournalMissingError`, bukan `InvalidRefundStatusError` yang menyesatkan; (2) `refunds.test.ts` "refuses a Payment whose standing Refund has no freeze journal": kini asersi pada kode error, bukan teks pesan Inggris; (3) dan (4) `campaigns/[slug]/refunds/[id]/approve/route.test.ts` dan `volunteer-trips/[slug]/refunds/[id]/approve/route.test.ts`: mock `ledgerEntry.findMany` menangani `transactionId: { in: [...] }` (detail mock, bukan perilaku).
- Sisa pekerjaan: `resolveRefund` (reject/fail) masih punya pemeriksaan "freeze or approval journal" sendiri yang melempar `InvalidRefundStatusError`; ia membaca dua jurnal sekaligus sehingga tidak dipaksakan ke helper.
- Commit: 7b5f3c5 (kode); commit ini sendiri hanya mencatat sha di tiket
