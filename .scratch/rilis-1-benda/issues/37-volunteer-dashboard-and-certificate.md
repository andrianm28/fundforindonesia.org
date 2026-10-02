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

## Syarat sebelum flag registrasi dinyalakan (review tiket 36, 2026-10-01)

Tautan bayar sebuah Registration `HOLD` hanya hidup di state klien (`RegisterButton`);
`redirectUrl` tidak disimpan di Payment, jadi halaman `/volunteer-trip/registrasi/[id]`
tidak bisa menampilkannya ulang. Volunteer yang menutup atau memuat ulang halaman bayar
kehilangan cara membayar dan kursinya tertahan 30 menit (ia bisa membatalkan lalu
mendaftar ulang). Tidak memblokir merge tiket 36 karena flag
`NEXT_PUBLIC_VOLUNTEER_ENABLED` default off, tetapi **wajib selesai sebelum flag
dinyalakan**: simpan atau ambil ulang instruksi pembayaran dari Payment, dan tampilkan
tombol "Lanjutkan pembayaran" pada kartu Registration `HOLD` di Dashboard dan di halaman
Registration. Sertakan tesnya.

## Acceptance

- Tes: terbit hanya untuk `CONFIRMED` dan hadir; tidak terbit untuk yang tidak
  hadir; `completeBatch` diulang tidak menerbitkan dua kali; kode tidak bisa
  ditebak berurutan; halaman publik tidak membocorkan data selain salinan beku.
- Tes migrasi terhadap basis data berisi baris. Review independen `sonnet`.
