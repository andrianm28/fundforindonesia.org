# 40: Trip Fee yang settle setelah penahanan kursi kedaluwarsa dikembalikan otomatis

**Type:** implementation

**Status:** in-review

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

## Implementation note (branch `claude/ticket-40-lapsed-auto-refund`)

- `refundLateSettlement` (`src/lib/volunteer/trip.ts`) kini mengembalikan penuh
  Registration yang, dibaca di bawah lock-nya, CANCELLED (`'late settlement'`)
  atau EXPIRED (`'lapsed settlement'`, kasus dan alasan baru di
  `src/lib/volunteer/refunds.ts`); CONFIRMED tetap tidak di-refund. Kursi tidak
  diberikan.
- Webhook settlement (`src/app/api/webhooks/[provider]/route.ts`) memanggilnya
  untuk hasil `'lapsed'` seperti `'cancelled'`, sesudah settlement commit; log
  tidak lagi menyebut "manual review". Doc `ConfirmRegistrationOutcome` diperbarui.
- Idempotensi datang dari dua penjaga yang sudah ada, keduanya diuji: pengiriman
  kedua kalah di balapan PENDING -> PAID (`updateMany` count 0) sehingga tak
  pernah mencapai confirm/refund; pemanggilan ulang langsung
  `refundLateSettlement` ditolak pengecekan sisa `createRefund`
  (`RefundExceedsRemainingError`, ditangkap dan dilog webhook). Tidak ada baris
  Refund kedua di kedua jalur.
- Catatan: kedaluwarsa hold itu malas (`expireLapsedHolds` hanya jalan saat hold
  berikutnya pada Batch), jadi HOLD yang lewat `holdExpiresAt` tetapi belum
  disapu masih menjadi `confirmed`. Tidak diubah, di luar cakupan.
- Self-review `code-review` dilakukan inline (subagent tidak bisa men-dispatch
  subagent); review independen `sonnet` tetap wajib. Ratchet 193 / 47, canary 3 / 3 / 6.
