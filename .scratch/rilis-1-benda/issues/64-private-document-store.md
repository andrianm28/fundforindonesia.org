# 64: D-1 private-document-store

**Status:** ready-for-agent

**Blocked by:** 01 (rilis-1-benda, resolved). C4 dan C5 dijawab owner 2026-10-04, tidak ada pemblokir tersisa.

**Ukuran:** XL, skema

**Catatan:** Skema: menyentuh `prisma/schema.prisma`/migrasi; ikuti aturan satu PR skema pada satu waktu, timestamp migrasi dibagi koordinator. Menyangkut keamanan data identitas; review independen `sonnet`.

**Keputusan (2026-10-04, ronde C):** C4 dokumen wajib sebelum M2 (untuk M1 dokumen YIEM diperiksa di luar produk dan Verifier mencatatnya); C5 penyimpanan di **volume lokal host, bukan S3**. Lihat Comments.

## Latar

Keputusan di `.scratch/rilis-1-benda/issues/03-documents.md`: dokumen yang diajukan harus hidup di storage privat dengan ACL, bukan di `public/uploads`. Sekarang Verifier mencentang label checklist tanpa dokumen di baliknya, sehingga FFI-04, FFI-05, dan FFI-08b bertumpu pada jaminan kosong. Dokumen wajib sebelum M2; untuk M1 dokumen YIEM ada di luar produk (C4).

## Berkas relevan

- `src/app/api/upload/route.ts` (endpoint publik yang tidak boleh dipakai untuk dokumen identitas)
- `prisma/schema.prisma` (model `Document` baru; `VerificationChecklistItem` baris ~912)
- `src/app/moderasi/campaigns/[id]/page.tsx` dan `CampaignModerationActions.tsx` (viewer Verifier)
- `src/app/campaign/create` dan `src/app/akun/kampanye-saya` (unggah saat create/edit)
- `src/lib/field-encryption.ts` (pola proteksi data)

## Acceptance

- [ ] Model `Document` (migrasi) dengan pemilik, jenis dokumen §7.1, ukuran, tipe, dan path relatif berkas pada volume (bukan path host absolut); tanpa URL publik
- [ ] Penyimpanan privat di volume lokal host, terpisah dari `public/uploads`, tidak di bawah `public/`, dan tidak dilayani nginx atau static; satu-satunya jalur baca adalah route ber-ACL yang meng-stream berkas
- [ ] ACL: hanya pengunggah, Verifier yang menangani Verification Request-nya, dan Admin yang boleh membuka dokumen; yang lain 404
- [ ] Unggah dokumen tersedia saat membuat dan mengedit Campaign/Partner Organisation
- [ ] Viewer dokumen untuk Verifier di layar moderasi
- [ ] Baris checklist ternonaktif sampai dokumen terkait ada
- [ ] Validasi tipe berkas dan magic byte; ukuran dibatasi
- [ ] Tes unit ACL, tes route, dan e2e unggah lalu lihat; tidak ada kredensial atau path host di repo

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C, C4 dan C5 dijawab owner): **C5, menyimpang dari rekomendasi awal (bukan S3).** Dokumen disimpan di **volume lokal di host**. Untuk D-1: volume privat terpisah (bukan `public/uploads`), disajikan **hanya** lewat route ber-ACL (Verifier yang menangani Verification Request-nya, Fundraiser pemilik, Admin), tidak lewat nginx atau static. Konsekuensi untuk builder: tidak ada signed URL dan tidak ada SDK object storage; lokasi volume dibaca dari env (nilai tidak di repo); route meng-stream berkas dengan `Cache-Control: no-store` dan nama berkas yang tidak ditebak. Perubahan compose atau volume produksi dan memasukkan volume ke backup malam serta offsite terenkripsi dikerjakan sesi VPS saat D-1 dideploy; itu di luar lingkup builder dan koordinator tidak men-deploy-nya sendiri. **C4:** dokumen wajib sebelum M2; untuk M1 dokumen YIEM diperiksa di luar produk dan Verifier mencatatnya. Status `needs-info` menjadi `ready-for-agent`.
