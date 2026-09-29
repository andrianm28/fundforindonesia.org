# 10: Bentuk sertifikat Volunteer Trip

**Type:** grilling

**Status:** resolved

**Blocked by:** —

## Why

Gerbang Fase 3 minta sertifikat Volunteer Trip; nol kode sama sekali (tidak
ada model, route, generator, atau template), dan beda dari item lain di
`triage-2026-09-28.md` karena belum ada kerangka jelas dari PRD sama sekali.
Owner 2026-09-28 (Bagian A, Q11): `prd-audit` dulu untuk memutuskan
bentuknya, baru diteruskan sebagai tiket implementasi
`rilis-1-benda` lajur L3 (lihat `rilis-1-benda/issues/29`) setelah bentuknya
diputuskan.

## Question

PDF, gambar, atau halaman yang cukup diklaim sebagai sertifikat? Apa yang
wajib tercantum (nama Volunteer, Trip, tanggal, siapa yang menandatangani
atau atas nama siapa platform menerbitkannya)? Siapa yang men-generate dan
kapan (otomatis saat Registration selesai, atau dipicu manual)?

## Answer

Owner (Dri), 2026-09-29, grilling putaran 1 dan 2, "ya semua": semua
rekomendasi berlaku.

- **Bentuk (Q1):** halaman web dengan kode unik, `/sertifikat/<kode>`, dengan
  tampilan cetak; Volunteer menyimpannya sebagai PDF dari browser. Tanpa PDF dari
  server, tanpa penyimpanan file.
- **Isi (Q2):** nama Volunteer, Trip dan destinasi, tanggal mulai dan selesai
  Batch, nama Fundraiser penyelenggara, kode, dan tanggal terbit. Diterbitkan
  oleh Fund for Indonesia (PT Jaya Korpora Prima) atas nama penyelenggara, tanpa
  tanda tangan orang. Nama dibekukan saat terbit.
- **Kapan (Q3):** otomatis saat Fundraiser menyelesaikan Batch, untuk setiap
  Registration yang berhak.
- **Siapa yang berhak (Q4):** Registration `CONFIRMED` yang ditandai hadir.
  Fundraiser menandai yang tidak hadir saat menyelesaikan Batch; semua hadir secara
  bawaan. Butuh kolom `Registration.attended`.
- **Koreksi dan pencabutan (Q12):** tidak ada di Rilis 1.

Diteruskan sebagai tiket implementasi `rilis-1-benda/issues/35` (kolom `attended`)
dan `37` (model dan halaman sertifikat).
