# 33: Katalog Volunteer Trip publik, detail Trip, dan pemilih Batch

**Type:** implementation

**Status:** ready-for-agent

**Blocked by:** none

## Why

Tidak ada halaman katalog Trip, detail Trip, atau pemilih Batch; semua rute API
ada tetapi tak satu pun dipanggil UI. Notifikasi `decideTripSubmission` bahkan
menautkan `/volunteer-trip/<slug>`, halaman yang tidak ada (404). Owner 2026-09-29, grilling tiket 29 dan `prd-audit/issues/10` (putaran 1 dan 2, "ya semua"): tiket 29
dipecah per layar (33 sampai 37) plus tiket kecil 38, 39, 40.

## Scope

- Katalog publik `/volunteer-trip`: hanya Trip berstatus `ACTIVE` yang punya
  sedikitnya satu Batch `OPEN` sebelum tenggat pendaftarannya. Kartu memuat judul,
  destinasi, Trip Fee, dan tanggal Batch terdekat.
- Detail `/volunteer-trip/[slug]` (rute yang sudah ditautkan notifikasi):
  destinasi, itinerary, cerita, Trip Fee, dan pemilih Batch (tanggal, sisa kursi
  dari kuota maksimum, tenggat pendaftaran). Volunteer yang belum masuk diarahkan
  ke halaman masuk lalu kembali ke halaman ini.
- Tombol "Daftar" di pemilih Batch hanya mengarah ke alur Registration (tiket 36).
  Sampai tiket 36 selesai, tombol itu tidak ditampilkan.
- Tautan menu pendukung "Volunteer" (PRD pasal 3) menunjuk ke katalog ini.
- Halaman yang membaca basis data memakai `export const dynamic = 'force-dynamic'`.

## Acceptance

- Trip `DRAFT`, `SUBMITTED`, `REJECTED`, `SUSPENDED`, `CANCELLED` tidak muncul di
  katalog dan detailnya menjawab 404 bagi publik.
- Tes untuk daftar, detail, dan Batch yang penuh atau lewat tenggat.
- Tidak ada perubahan skema atau kode uang.
