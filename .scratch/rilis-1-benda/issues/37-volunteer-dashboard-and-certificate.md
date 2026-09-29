# 37: Dashboard Volunteer dan Sertifikat Keikutsertaan

**Type:** implementation

**Status:** ready-for-agent

**Blocked by:** 35 (kolom `attended` dan penyelesaian Batch), 36 (Registration
yang bisa dibuat lewat UI).

## Why

PRD FFI-12: "Sertifikat digital dan rekam Registration pada dashboard". Sertifikat
tidak punya kode sama sekali. Bentuknya diputuskan di `prd-audit/issues/10`
(Owner 2026-09-29, grilling tiket 29 dan `prd-audit/issues/10` (putaran 1 dan 2, "ya semua"): Q1 sampai Q4, Q11, Q12).

## Scope: dashboard

- Bagian Volunteer di dashboard pengguna: daftar Registration dengan status
  (Hold dengan hitungan mundur, Confirmed, Expired, Cancelled), status Refund bila
  ada, tombol batalkan yang menampilkan nominal Refund bertingkat lebih dulu, dan
  tautan sertifikat bila sudah terbit.
- "Catatan kontribusi" = daftar Trip yang sudah selesai diikuti (judul, destinasi,
  tanggal), tanpa angka dampak (belum ada sumber datanya).

## Scope: sertifikat

- Model baru `VolunteerCertificate`: satu per Registration (unik), `code` unik dan
  tidak dapat ditebak, `issuedAt`, dan salinan beku dari nama Volunteer, judul
  Trip, destinasi, tanggal mulai dan selesai Batch, serta nama Fundraiser
  penyelenggara. Migrasi memakai timestamp `20260930110000`.
- Terbit otomatis, dalam transaksi yang sama dengan `completeBatch`, untuk setiap
  Registration `CONFIRMED` dengan `attended = true`. Tidak ada jalur lain yang
  menerbitkan.
- Halaman publik `/sertifikat/[code]` (tanpa masuk) dengan tampilan cetak, jadi
  Volunteer bisa "Simpan sebagai PDF" dari browser. Isinya: nama Volunteer, Trip
  dan destinasi, tanggal Batch, penyelenggara, kode, dan tanggal terbit. Bunyinya:
  diterbitkan oleh Fund for Indonesia (PT Jaya Korpora Prima) atas nama
  penyelenggara, tanpa tanda tangan orang.
- Halaman itu menampilkan hanya isi salinan beku, tidak membaca profil Volunteer.
  Halaman dengan kode yang tidak ada menjawab 404 tanpa membocorkan apa pun.
- Tidak ada koreksi atau pencabutan sertifikat di Rilis 1 (keputusan Q12); bila
  kasusnya muncul saat Soft Launch, itu tiket tersendiri.
- Tidak ada PDF dari server dan tidak ada penyimpanan file (menunggu tiket 03).

## Acceptance

- Tes: terbit hanya untuk `CONFIRMED` dan hadir; tidak terbit untuk yang tidak
  hadir; `completeBatch` diulang tidak menerbitkan dua kali; kode tidak bisa
  ditebak berurutan; halaman publik tidak membocorkan data selain salinan beku.
- Tes migrasi terhadap basis data berisi baris. Review independen `sonnet`.
