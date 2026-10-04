# 87: Konfirmasi donasi menampilkan persentase Platform Fee, Escrow Hold, dan jumlah bersih

**Type:** implementation (kode tampilan yang membaca logika uang)

**Status:** ready-for-agent

**Blocked by:** none

## Why

Keputusan owner 2026-09-28 (`rilis-1-benda/issues/04`, jawaban butir 4): Checkout
wajib menampilkan persentase Platform Fee dan lama Escrow Hold sebelum Donor
membayar. Itu gerbang FFI-01 yang belum terpenuhi: halaman Campaign sudah
menampilkan keduanya (prd-compliance 17 dan 18), tetapi layar konfirmasi donasi
(`DonationConfirmation`) hanya menjelaskan Provider Fee. Donor yang langsung
masuk ke halaman donasi tidak pernah melihat angkanya.

Paket rencana: P2 `checkout-fee-hold-disclosure`, ukuran S.

## Scope

Di layar konfirmasi donasi (langkah 3 di `src/app/campaign/[slug]/donate`), Donor
melihat, untuk nominal yang dipilih:

1. **Platform Fee**: persentase yang berlaku untuk Campaign itu (Campaign, lalu
   Category, lalu Kind; `resolvePlatformFeeBasisForCampaign`) dan nominal rupiahnya
   dari `computePlatformFee`, fungsi yang sama dengan jalur uang
   (`chargeDonation`). Tidak ada konstanta atau pembulatan baru.
2. **Escrow Hold**: lama masa tahan dalam hari, dari `ESCROW_HOLD_DAYS`.
3. **Perkiraan jumlah bersih** yang diterima Campaign: nominal dikurangi Platform
   Fee, dan dinyatakan sebelum Provider Fee, karena Provider Fee baru diketahui
   saat Settlement (CONTEXT.md, Provider Fee, Net).
4. **Fee 0 ditampilkan jujur**: bila persentase 0, atau nominal di bawah ambang
   pembebasan (`PlatformFeeThreshold`), layar menyatakan Platform Fee Rp0 dan
   tidak menyembunyikan barisnya.

Rute `GET /api/campaigns/[slug]` sudah membawa `platformFeePercentBps` dan
`escrowHoldDays`; ia perlu membawa pula ambang pembebasan agar klien dapat
menghitung fee dengan `computePlatformFee`.

Di luar cakupan: perhitungan uang apa pun, skema Prisma, `CONTEXT.md`, halaman
Admin Platform Fee, Escrow Hold per Campaign.

## Kriteria penerimaan

- [ ] Layar konfirmasi menampilkan persentase Platform Fee dan nominalnya, dihitung dengan `computePlatformFee` atas basis yang di-resolve server.
- [ ] Layar konfirmasi menampilkan lama Escrow Hold dari `ESCROW_HOLD_DAYS`, bukan angka tertulis di komponen.
- [ ] Layar konfirmasi menampilkan perkiraan jumlah bersih untuk Campaign, dengan catatan bahwa Provider Fee belum termasuk.
- [ ] Fee 0 (persentase 0 atau nominal di bawah ambang) tampil sebagai Rp0, bukan disembunyikan.
- [ ] `GET /api/campaigns/[slug]` membawa ambang pembebasan, dengan tes.
- [ ] Tidak ada perubahan pada perhitungan uang (`src/lib/money/*`), skema, atau `CONTEXT.md`.

## Comments
