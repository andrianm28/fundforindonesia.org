# 36: Alur Registration dan pembayaran Trip Fee

**Type:** implementation

**Status:** in-review

**Blocked by:** 33 (pemilih Batch), 35 (Trip dan Batch bisa dibuat lewat UI),
40 (aturan settle terlambat, agar layar ini tidak menjanjikan hal yang salah).

## Why

Registration, penahanan kursi, dan settlement Trip Fee ada di kode dan API,
tetapi tak ada layar. Owner 2026-09-29, grilling tiket 29 dan `prd-audit/issues/10` (putaran 1 dan 2, "ya semua"): alur Registration dibangun sekarang dan digerbangi
flag, karena penyedia pembayaran nyata belum ada (Q7).

## Scope

- Dari pemilih Batch (tiket 33): halaman ringkasan Registration dengan Trip,
  Batch, tanggal, Trip Fee, dan **tabel Refund bertingkat dengan tanggal nyata
  Batch itu, ditampilkan sebelum Volunteer membayar**: 14 hari atau lebih sebelum
  berangkat kembali penuh, 3 sampai 13 hari separuh, kurang dari 3 hari nol
  (keputusan Q8, angka di `src/lib/volunteer/refunds.ts`).
- Buat Registration (kursi ditahan 30 menit, `HOLD_WINDOW_MS`), tampilkan hitungan
  mundur, arahkan ke pembayaran lewat jalur Payment yang sama dengan donasi, dan
  halaman konfirmasi setelah Settlement.
- Flag baru `NEXT_PUBLIC_VOLUNTEER_ENABLED`, bawaan mati. Selama mati, tombol
  "Daftar" pada tiket 33 tidak muncul dan rute pembuat Registration menolak dengan
  pesan yang jelas; server yang menegakkan, bukan hanya tampilan. Owner menyalakannya
  hanya setelah Track A, adapter Xendit, dan satu uji Trip Fee sandbox selesai.
- Volunteer membatalkan Registration miliknya sendiri dari sini atau dari
  dashboard (tiket 37), dengan nominal Refund ditampilkan sebelum ia mengonfirmasi.

## Acceptance

- Tes yang membuktikan flag mati menolak pembuatan Registration di server.
- Tes tampilan tabel Refund untuk ketiga tingkat dan untuk hari batas persis.
- Kode uang tidak berubah di tiket ini; perubahan settle terlambat ada di tiket 40.
- Review independen `sonnet` (jalur uang).
