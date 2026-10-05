# 92: B-1 beta-sandbox-mode

**Status:** awaiting-merge

**Blocked by:** none

**Ukuran:** L

**Catatan:** Kode uang + keamanan + skema. Wajib review independen `sonnet` dengan bukti diposting di PR. Memakai slot skema (satu PR skema pada satu waktu): migrasi `20261005010000_payment_sandbox_stamp`. Menggantikan G-1 staging (PR #224 ditutup owner, tanpa subdomain staging).

## Latar

Keputusan owner 2026-10-04/05 (bagian "Keputusan susulan: beta publik menggantikan staging" di `.scratch/percepatan-full-rilis/keputusan-ronde-c.md`): beta publik berjalan di domain utama dengan Sumopod sandbox, tanpa uang nyata. Beta menggantikan peran staging untuk gladi Gelombang 1; gladi tertutup C1 dengan uang nyata tetap menunggu M-a dan A-1. Go-live = cabut penanda beta + isi URL live.

## Keputusan

1. **Penanda mode beta**: satu env server eksplisit `BETA_SANDBOX`, cocok hanya string persis `true`, dibaca per panggilan, bukan `NEXT_PUBLIC_`. Saat aktif, guard Sumopod (`src/lib/payments/production-readiness.ts`) menerima HANYA `https:` dengan hostname persis `api-pay-sandbox.sumopod.com` dan menolak URL live; tanpa penanda, perilaku produksi tidak berubah (sandbox ditolak). `docker-compose.prod.yml` meneruskan `BETA_SANDBOX: ${BETA_SANDBOX:-}`. Kode dipakai ulang dari branch tertutup `claude/go-live-ops-02-staging` (konsep "staging" menjadi "beta"); compose staging, `cd.yml`, dan runbook staging tidak dibawa.
2. **Banner** "Beta, tidak ada uang nyata" di semua halaman publik (layout), konfirmasi donasi, dan Receipt (halaman dan email) saat penanda aktif. Situs tetap diindeks (tanpa `noindex`). Komponen klien tidak membaca env server: flag dialirkan dari server component.
3. **Skema**: setiap Payment dicap mode saat dibuat (`sandbox Boolean @default(false)`), diisi dari penanda pada titik pembuatan Payment (donasi dan Trip Fee). Satu predikat bernama "Payment yang dihitung" di `src/lib/money/`: di mode beta semua dihitung; di mode live baris ber-cap sandbox dikeluarkan. Diterapkan ke total publik (progres Campaign, Impact) dan laporan rekonsiliasi Admin. Jalur lain yang membaca uang dari Ledger (saldo, Payout, Refund) TIDAK dirombak; daftarnya ada di Comments sebagai pekerjaan lanjutan.
4. **Tes** lewat seam publik: guard (penanda persis, lookalike, live ditolak di beta, sandbox ditolak tanpa penanda), cap Payment, predikat, banner tampil/tidak.

## Acceptance

- [x] `BETA_SANDBOX=true` persis membuka Sumopod sandbox persis dan menolak URL live dan lookalike; tanpa penanda sandbox tetap ditolak
- [x] `docker-compose.prod.yml` meneruskan `BETA_SANDBOX`; tes compose diperbarui
- [x] Banner tampil di layout publik, konfirmasi donasi, halaman Receipt, dan email Receipt hanya saat penanda aktif; tanpa `noindex`
- [x] Payment donasi dan Trip Fee dicap `sandbox` dari penanda saat dibuat; migrasi `20261005010000_payment_sandbox_stamp`
- [x] Satu predikat "Payment yang dihitung" dipakai oleh progres Campaign, Impact, dan rekonsiliasi Admin
- [x] Jalur Ledger lain yang belum dikecualikan terdaftar di Comments

## Comments

- 2026-10-05: ditulis dari keputusan owner (ronde C, bagian susulan). Nama env untuk `.env.example`: `BETA_SANDBOX` (koordinator yang menyentuh `.env.example`).
- 2026-10-05: dikerjakan di branch `claude/rilis-1-92-beta-sandbox-mode` (PR dibuat koordinator). Keputusan implementasi:
  - Penanda: `isBetaSandbox()` di `src/lib/deploy-environment.ts` (persis `true`, per panggilan). Guard Sumopod: `isExactlySumopodSandbox` (https + hostname persis `api-pay-sandbox.sumopod.com`); saat beta, URL lain (live, lookalike, `@`, path) ditolak; tanpa penanda tidak berubah.
  - Skema: `Payment.sandbox Boolean @default(false)`, migrasi `20261005010000_payment_sandbox_stamp`, diisi `currentPaymentSandboxStamp()` di `chargeDonation` dan rute pendaftaran Trip Fee.
  - Predikat: `src/lib/money/counted-payment.ts`: `countedPaymentWhere()`, `isCountedPayment()`, `ledgerWhereWithoutUncountedPayments()` (Impact: kolam per Campaign tanpa leg Payment beta dan Refund-nya, ditulis aman-NULL), `withCountedCollectedAmount()`. Diterapkan di Impact, rekonsiliasi Admin (sisi ledger, kolom `collectedAmount`, watchdog escrow, stranded escrow, Trip Payment yatim, `collectedByKind`), dan progres Campaign publik (halaman Campaign, beranda, explore kategori, `GET /api/campaigns` dan `/api/campaigns/[slug]`, yang juga melayani explore/all dan search).
  - Progres Campaign: `Campaign.collectedAmount` adalah penghitung seumur hidup yang diinkremen webhook, jadi saat live angka publik = penghitung dikurangi Gross Payment `PAID` ber-cap sandbox. Penghitungnya sendiri tidak diubah.
  - Banner: `BetaBanner` (tiga redaksi: situs, donasi, Receipt). Layout akar membaca penanda di server lewat `betaSandboxForThisRequest()` (`await connection()` lebih dulu) dan mengalirkannya ke klien lewat `BetaSandboxContext`. Receipt (halaman dan email, termasuk kirim ulang) juga memberi catatan bila Payment-nya ber-cap sandbox walau penanda sudah dicabut, supaya Receipt beta tidak tampak seperti bukti donasi sungguhan setelah go-live. Tanpa `noindex`.
  - Akibat yang perlu diketahui: karena penanda dibaca per permintaan, seluruh rute menjadi dinamis (`next build` menandai semuanya `ƒ`). Beranda dan halaman Campaign kehilangan cache ISR 60 detik (`revalidate` tetap tertulis tetapi tidak berlaku). Alternatifnya banner dimuat klien dari API, tetapi itu melanggar aturan "alirkan dari server component".
  - Env baru: `BETA_SANDBOX` (belum ada di `.env.example`; koordinator).
  - Jalur Ledger yang BELUM dikecualikan (pekerjaan lanjutan, sengaja tidak dirombak): (1) saldo per Campaign (`accountBalance`, `src/lib/wallet.ts`, `/api/balance`) dan dana yang boleh di-Payout (`src/lib/money/payouts.ts`, `trip-payout-funds.ts`): uang beta tercampur dengan uang live; (2) Payout dan jurnalnya, termasuk garis `payouts` dan `beneficiaries` di Impact; (3) Refund (`refunds.ts`, batas Refund, `refund-standing`) terhadap Payment beta; (4) sapuan Escrow Hold (`escrow.ts`) yang tetap melepas Payment beta; (5) Provider Balance dan `providerReconciliation.pots` (satu kantong per penyedia, beta dan live tercampur) serta `providerWithdrawals`; (6) `negativeBalances`, `tripNegativeBalances`, dan pemeriksaan saldo ledger lain di rekonsiliasi (membaca ledger per Campaign/Trip tanpa memilah Payment); (7) penghitung `collectedAmount` mentah yang dibaca jalur non-publik: `scrutiny.ts` (batas Donation dan Campaign), `abuse-thresholds.ts`, `/akun/kampanye-saya`, `/api/user/campaigns`, `/admin/campaigns`, urutan "Pilihan Kami" di beranda (`orderBy collectedAmount`); (8) Payment Trip Fee ber-cap sandbox di panel Trip. Sebelum go-live perlu keputusan owner: bersihkan data beta (basis data bersih) atau lanjutkan memilah jalur-jalur di atas.
- 2026-10-05 (koordinator, review independen PR #230): Payment sandbox berstatus REFUNDED kini ikut dikurangkan dari `collectedAmount` publik (Refund penuh tidak pernah men-decrement penghitung seumur hidup); Receipt tidak lagi menyaring Payment `PAID` saja, jadi Receipt beta yang kemudian di-Refund tetap bercatatan beta. Jalur tambahan yang belum memilah beta (lanjutan sebelum go-live): `src/lib/money/dormant-balances.ts` (jumlah saldo ledger per akun), `src/lib/money/manual-contributions.ts` (jumlah ledger), dan `donationCount` publik (`_count.donations`).
