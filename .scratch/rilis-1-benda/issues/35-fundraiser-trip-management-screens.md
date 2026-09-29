# 35: Layar Fundraiser untuk Volunteer Trip dan Batch

**Type:** implementation

**Status:** ready-for-agent

**Blocked by:** 33 (komponen tampilan Trip dan Batch yang dipakai ulang); 34
tidak memblokir kode tetapi Trip baru belum bisa aktif tanpanya.

## Why

Daftar layar di tiket 29 hanya sisi Volunteer dan Verifier. Tanpa layar sisi
Fundraiser, Trip pertama hanya bisa dibuat lewat panggilan API langsung, yang
melanggar definisi Rilis 1 ("tidak ada langkah yang memerlukan akses teknis
langsung"). Owner 2026-09-29, grilling tiket 29 dan `prd-audit/issues/10` (putaran 1 dan 2, "ya semua"): sisi Fundraiser masuk lingkup (Q5).

## Scope

- Dashboard Fundraiser: buat dan sunting Draft Trip (judul, deskripsi, cerita,
  sampul, destinasi, itinerary, Trip Fee), ajukan untuk diperiksa, lihat status
  dan alasan penolakan.
- Tambah dan ubah Batch (tanggal mulai dan selesai, tenggat pendaftaran, kuota
  maksimum, kuota minimum), selama Batch masih `OPEN`.
- Batalkan Batch (`cancelBatch`, hanya bila kuota minimum tidak tercapai; Refund
  penuh otomatis) dan tunjukkan alasan penolakan server bila kuotanya tercapai.
- Selesaikan Batch (`completeBatch`, yang sudah menolak sebelum tanggal selesai Batch lewat, `BatchNotEndedError`) lewat layar yang menampilkan setiap Registration
  `CONFIRMED` dengan kotak "hadir", semuanya tercentang secara bawaan
  (keputusan Q4). Yang tidak dicentang tidak menerima sertifikat.

## Schema

- Kolom baru `Registration.attended` (`Boolean`, `NOT NULL DEFAULT false`),
  diisi saat `completeBatch`, tidak diubah sesudahnya. Migrasi memakai timestamp
  `20260930100000` (dicadangkan untuk tiket ini). `completeBatch` menerima daftar
  id Registration yang hadir; sisanya tersimpan `false`.
- Hanya Fundraiser pemilik Trip yang boleh menandai kehadiran (Capacity
  Fundraiser); ditegakkan di server dan dites.

## Acceptance

- Tes layar, tes `completeBatch` dengan sebagian hadir, tes migrasi terhadap
  basis data berisi baris (lihat `docs/agents/verification.md`).
- Kode uang tidak berubah; `completeBatch` tidak menulis Refund atau ledger.
- Review independen `sonnet` (menyentuh skema dan aturan peran).
