# 01: E9 tim-csr-account

**Status:** ready-for-agent

**Blocked by:** none; E9 dijawab owner 2026-10-04

**Ukuran:** L, skema

**Catatan:** Skema: menyentuh `prisma/schema.prisma`/migrasi; ikuti aturan satu PR skema pada satu waktu, timestamp migrasi dibagi koordinator. Menyimpan kontak perusahaan: review privasi.

**Keputusan (2026-10-04, ronde C):** E9 (a) akun per orang plus keanggotaan perusahaan; (b) verifikasi ringan lewat domain email; (c) inquiry plus riwayat status plus unduh laporan dampak Program yang dibiayai perusahaannya; (d) retensi selama aktif plus 2 tahun setelah inquiry terakhir, lalu dianonimkan.

## Latar

Tahap pertama: email konfirmasi ke perusahaan yang mengirim Partnership Inquiry (S), karena sekarang perusahaan tidak mendengar apa pun dan notifikasi ke tim platform memuat alamat perusahaan tanpa `replyTo`. Tahap kedua, belakangan: akun Tim CSR lengkap. Keputusan dasar ada di `.scratch/rilis-1-benda/issues/08-tim-csr-account.md`: Tim CSR adalah istilah, bukan Assignment; beberapa orang boleh berbagi satu perusahaan. Yang belum diputuskan di sana: akun menempel pada orang atau perusahaan, apakah perusahaan diverifikasi, dan apa yang bisa dilakukan akun setelah daftar. Itulah empat sub-pertanyaan grilling.

## Berkas relevan

- `src/lib/partnership-inquiries.ts`, `src/lib/partnership-inquiry-followup.ts`
- `src/lib/mail/partnership-inquiry.ts`
- `src/app/api/partnership-inquiries/`
- `src/app/admin/partnership-inquiries/page.tsx`
- `prisma/schema.prisma` (`PartnershipInquiry` ~359)

## Acceptance

- [ ] Tahap 1: pengirim Inquiry menerima email konfirmasi; notifikasi ke tim platform memakai `replyTo` perusahaan; gagal kirim tidak menggagalkan Inquiry
- [x] Hasil empat sub-pertanyaan dicatat di tiket sebelum tahap 2 dimulai (2026-10-04, lihat Comments)
- [ ] Tahap 2: akun Tim CSR tanpa `Assignment`, beberapa pengguna per perusahaan, daftar Inquiry perusahaan; migrasi tanpa kehilangan data
- [ ] Tahap 2 mengikuti keputusan 2026-10-04: verifikasi ringan lewat domain email, riwayat status inquiry, unduhan laporan dampak Program yang dibiayai perusahaan (tanpa data pribadi donor), retensi aktif + 2 tahun lalu anonimisasi
- [ ] Tes route, domain, dan e2e; alamat perusahaan tidak bocor ke pihak lain

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): E9 dijawab owner, keempat sub-pertanyaan `rilis-1-benda/issues/08`:
  - (a) Akun berjangkar pada **orang**, dengan **keanggotaan perusahaan** (satu perusahaan, beberapa orang; tetap tanpa `Assignment`).
  - (b) **Verifikasi ringan lewat domain email** perusahaan.
  - (c) Setelah mendaftar: mengajukan Partnership Inquiry, melihat **riwayat status** inquiry, dan **mengunduh laporan dampak Program yang dibiayai perusahaannya**.
  - (d) Retensi: selama akun aktif ditambah **2 tahun setelah inquiry terakhir**, lalu data kontak **dianonimkan**.
  Acceptance tahap 2 perlu menambah: unduhan laporan dampak per Program yang dibiayai perusahaan (hanya data Program, tanpa data pribadi donor), job anonimisasi retensi, dan pengecekan domain email. Tahap 1 (email konfirmasi) tidak bergantung pada jawaban ini. `needs-info` menjadi `ready-for-agent`.
