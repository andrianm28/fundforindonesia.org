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

- [x] Model `Document` (migrasi) dengan pemilik, jenis dokumen §7.1, ukuran, tipe, dan path relatif berkas pada volume (bukan path host absolut); tanpa URL publik
- [x] Penyimpanan privat di volume lokal host, terpisah dari `public/uploads`, tidak di bawah `public/`, dan tidak dilayani nginx atau static; satu-satunya jalur baca adalah route ber-ACL yang meng-stream berkas
- [x] ACL: hanya pengunggah, Verifier yang menangani Verification Request-nya, dan Admin yang boleh membuka dokumen; yang lain 404
- [x] Unggah dokumen tersedia saat membuat dan mengedit Campaign/Partner Organisation
- [x] Viewer dokumen untuk Verifier di layar moderasi
- [x] Baris checklist ternonaktif sampai dokumen terkait ada
- [x] Validasi tipe berkas dan magic byte; ukuran dibatasi
- [x] Tes unit ACL, tes route, dan e2e unggah lalu lihat; tidak ada kredensial atau path host di repo

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C, C4 dan C5 dijawab owner): **C5, menyimpang dari rekomendasi awal (bukan S3).** Dokumen disimpan di **volume lokal di host**. Untuk D-1: volume privat terpisah (bukan `public/uploads`), disajikan **hanya** lewat route ber-ACL (Verifier yang menangani Verification Request-nya, Fundraiser pemilik, Admin), tidak lewat nginx atau static. Konsekuensi untuk builder: tidak ada signed URL dan tidak ada SDK object storage; lokasi volume dibaca dari env (nilai tidak di repo); route meng-stream berkas dengan `Cache-Control: no-store` dan nama berkas yang tidak ditebak. Perubahan compose atau volume produksi dan memasukkan volume ke backup malam serta offsite terenkripsi dikerjakan sesi VPS saat D-1 dideploy; itu di luar lingkup builder dan koordinator tidak men-deploy-nya sendiri. **C4:** dokumen wajib sebelum M2; untuk M1 dokumen YIEM diperiksa di luar produk dan Verifier mencatatnya. Status `needs-info` menjadi `ready-for-agent`.

- 2026-10-29 (builder, thread "Kerjakan tiket 64 dokumen privat"): dibangun di branch `claude/project-thread-5iqono`, migrasi `20261029180000_private_documents` (setelah #264). Keputusan builder: (1) `VerificationChecklistItem.requiresDocument` baru, di-seed `true` untuk butir §7.1 yang berupa kertas, `false` untuk Kind Authorisation dan "bukan duplikat"; Admin mengubahnya di editor checklist. (2) Server menolak centang butir ber-dokumen tanpa dokumen pada keputusan apa pun (`CHECKLIST_DOCUMENT_MISSING`, 422); snapshot lama tanpa flag dinilai dari setelan butir saat ini. (3) ACL dokumen Lembaga Mitra: semua Verifier, Admin, pengunggah, dan akun organisasi itu; dokumen Campaign: pengunggah, Fundraiser pemilik, Admin, dan Verifier selama ada Verification Request PENDING atau yang pernah memutuskan salah satunya. (4) Tidak ada hapus dokumen (keputusan 03). (5) Compose prod memasang volume eksternal `ffi_private_documents` di `/app/private-documents`; host harus `docker volume create ffi_private_documents` sebelum deploy dan memasukkannya ke backup. Tanpa `PRIVATE_DOCUMENT_DIR` di produksi, unggah menjawab 503.

- 2026-10-29 (builder, setelah review independen sonnet): (a) Unggah kini membaca body dengan batas byte (10MB + 64KB) sebelum mem-parse multipart, jadi Content-Length yang hilang atau berbohong tetap ditolak 413. (b) Berkas setengah tertulis dihapus bila penulisan gagal. (c) "Verifier yang menangani" diartikan sebagai Verifier mana pun selama Verification Request PENDING, karena antrean moderasi tidak menugaskan request ke satu Verifier; Verifier yang pernah memutuskan tetap bisa membuka untuk audit. (d) Saat deploy, request PENDING yang sudah ada dinilai dari setelan butir saat ini: Verifier tidak bisa menyetujui butir kertas sebelum Fundraiser mengunggah dokumennya (Fundraiser tetap bisa mengunggah saat SUBMITTED). (e) Dokumen dari ronde yang ditolak tetap memenuhi butir yang sama di ronde berikutnya; Verifier menilai isinya. (f) Unggah dokumen Lembaga Mitra hanya untuk Verifier dan Admin, karena merekalah yang mendaftarkan Lembaga Mitra.
