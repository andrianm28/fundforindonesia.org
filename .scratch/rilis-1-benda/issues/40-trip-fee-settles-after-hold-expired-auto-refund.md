# 40: Trip Fee yang settle setelah penahanan kursi kedaluwarsa dikembalikan otomatis

**Type:** implementation

**Status:** ready-for-agent

**Blocked by:** none

## Why

Bila Trip Fee settle setelah penahanan kursinya kedaluwarsa (bukan dibatalkan),
`confirmRegistration` mengembalikan hasil `'lapsed'`: uang sudah dikumpulkan, tak
ada kursi, dan "dibiarkan untuk ditinjau manual". Tidak ada layar atau antrean
untuk tinjauan itu, jadi uangnya tidak terlihat siapa pun. Owner 2026-09-29, grilling tiket 29 dan `prd-audit/issues/10` (putaran 1 dan 2, "ya semua"): Q9, opsi (a).

## Scope

- Hasil `'lapsed'` diperlakukan seperti kasus "settle setelah dibatalkan" yang sudah
  ada (`refundLateSettlement`, aturan ketiga Trip Fee di CONTEXT.md): Refund penuh
  otomatis begitu penyelesaian itu terdeteksi, dengan alasan yang jelas.
- Idempoten: settlement yang diproses ulang tidak membuat dua Refund.
- Kursi tidak diberikan sekalipun masih tersedia; itu di luar aturan ini.

## Acceptance

- Tes untuk: settle setelah kedaluwarsa (satu Refund penuh), settle ganda (tidak
  ada Refund kedua), dan settle tepat sebelum kedaluwarsa (tetap `confirmed`).
- Perubahan menyentuh kode uang di `src/lib/volunteer/trip.ts`: review independen
  `sonnet` wajib, dan ketiga canary carry-trap harus sama dengan `main`.
