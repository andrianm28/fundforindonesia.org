# 01: E9 tim-csr-account

**Status:** needs-info

**Blocked by:** none; menunggu C23 (sub-pertanyaan E8/E9 dari tiketnya) dan grilling empat sub-pertanyaan

**Ukuran:** L, skema

**Catatan:** Skema: menyentuh `prisma/schema.prisma`/migrasi; ikuti aturan satu PR skema pada satu waktu, timestamp migrasi dibagi koordinator. Menyimpan kontak perusahaan: review privasi.

**Menunggu keputusan:** C23 (E8/E9: sub-pertanyaan dari tiketnya) serta grilling singkat. Tahap 1 dapat dipecah dan dikerjakan lebih dulu setelah owner setuju.

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
- [ ] Hasil grilling empat sub-pertanyaan dicatat di tiket sebelum tahap 2 dimulai
- [ ] Tahap 2: akun Tim CSR tanpa `Assignment`, beberapa pengguna per perusahaan, daftar Inquiry perusahaan; migrasi tanpa kehilangan data
- [ ] Tes route, domain, dan e2e; alamat perusahaan tidak bocor ke pihak lain

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
