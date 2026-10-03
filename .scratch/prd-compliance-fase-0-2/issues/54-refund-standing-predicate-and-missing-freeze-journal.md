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

- [ ] Satu predikat bersama untuk "Refund masih berdiri", dipakai semua pembaca
- [ ] Satu helper untuk membaca jurnal freeze yang melempar satu error domain
      yang jujur bila jurnal tidak ada
- [ ] Tidak ada perubahan perilaku: tes yang ada tetap hijau tanpa diubah

## Comments

- 2026-10-03: owner menyetujui pengerjaan ("ya semua").
