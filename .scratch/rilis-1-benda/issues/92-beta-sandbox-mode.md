# 92: B-1 beta-sandbox-mode

**Status:** ready-for-agent

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

- [ ] `BETA_SANDBOX=true` persis membuka Sumopod sandbox persis dan menolak URL live dan lookalike; tanpa penanda sandbox tetap ditolak
- [ ] `docker-compose.prod.yml` meneruskan `BETA_SANDBOX`; tes compose diperbarui
- [ ] Banner tampil di layout publik, konfirmasi donasi, halaman Receipt, dan email Receipt hanya saat penanda aktif; tanpa `noindex`
- [ ] Payment donasi dan Trip Fee dicap `sandbox` dari penanda saat dibuat; migrasi `20261005010000_payment_sandbox_stamp`
- [ ] Satu predikat "Payment yang dihitung" dipakai oleh progres Campaign, Impact, dan rekonsiliasi Admin
- [ ] Jalur Ledger lain yang belum dikecualikan terdaftar di Comments

## Comments

- 2026-10-05: ditulis dari keputusan owner (ronde C, bagian susulan). Nama env untuk `.env.example`: `BETA_SANDBOX` (koordinator yang menyentuh `.env.example`).
