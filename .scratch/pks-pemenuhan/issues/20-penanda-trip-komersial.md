# 20: Penanda komersial pada Trip, supaya biayanya masuk ke BADAN_USAHA

**Blocked by:** 04 (dua merchant, fungsi routing)

**Status:** needs-triage

**What to build:** Tindak lanjut tiket 04 (review independen sumbu Spec, SHOULD-FIX). Kontrak Pasal 4.1(2) memisahkan uang yayasan dari pendapatan badan usaha, dan ADR 0027 sudah punya jalurnya: `merchantEntityForPurpose({ kind: 'trip_fee', commercial: true })` mengembalikan `BADAN_USAHA`. Yang belum ada adalah penandanya di Trip, jadi hari ini setiap Trip Fee dikirim ke merchant YAYASAN, termasuk Trip yang sebenarnya komersial.

Usulan lingkup (perlu dikonfirmasi owner saat triage):

1. Kolom `Trip.commercial` (Boolean, default false) dengan migrasi aditif. Trip yang sudah ada tetap tidak komersial.
2. Hanya Admin yang bisa menandai (bukan Fundraiser/pemilik Trip), dengan entri audit; penanda dikunci setelah Registration pertama berbayar, supaya satu Trip tidak punya Trip Fee di dua merchant.
3. Pendaftaran Trip (`/api/volunteer-trips/[slug]/batches/[id]/registrations`) membaca penanda itu dan meneruskannya ke `merchantEntityForPurpose`; resolusi provider dan penyimpanan `Payment.merchantEntity` sudah mengikuti hasilnya. Tanpa kredensial BADAN_USAHA, pendaftaran ditolak dengan pesan jelas (tidak jatuh ke YAYASAN), seperti yang sudah diuji di tiket 04.
4. Keputusan terbuka tiket 04 soal Payout: Trip Fee komersial yang dicairkan lewat modul Payout dibukukan `YAYASAN` (`PAYOUT_MERCHANT`), padahal uangnya BADAN_USAHA. Putuskan apakah Trip komersial dicairkan lewat modul Payout atau jalur lain, dan sesuaikan pembukuan Payout sebelum penanda diaktifkan di produksi.
5. Refund dan rekonsiliasi per entitas sudah membaca `Payment.merchantEntity`, jadi tidak perlu diubah; cukup diuji untuk Trip komersial.

- [ ] Test: Trip komersial -> Payment `BADAN_USAHA`; Trip biasa -> `YAYASAN`
- [ ] Test: Trip komersial tanpa kredensial BADAN_USAHA ditolak, tidak membuat Payment
- [ ] Test: hanya Admin yang bisa menandai; terkunci setelah Registration berbayar pertama
- [ ] Keputusan Payout untuk Trip komersial dicatat (ADR 0027 diperbarui)
- [ ] Review independen sonnet (uang)

## Comments

- 2026-11-10: dibuat dari review independen tiket 04 (sumbu Spec).
