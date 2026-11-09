# 17: Modul kolaborasi CSR lengkap

**Blocked by:** 15 (slot skema)

**Status:** done

**What to build:** Pasal 3.6, BERSYARAT, owner memutuskan dikerjakan. Formulir kolaborasi (publik dan akun Tim CSR) menambah: kisaran anggaran (pilihan rentang), periode (mulai-selesai bulan), unggah proposal (Document privat, PDF), alamat dan NPWP perusahaan (opsional). Status prospek menjadi 8: Baru, Dihubungi, Proposal, Negosiasi, Disetujui, Berjalan, Selesai, Tidak dilanjutkan (migrasi memetakan 3 status lama: NOT_YET_FOLLOWED_UP->Baru, IN_PROGRESS->Dihubungi, DONE->Selesai). Admin: tetapkan PIC (pengguna Admin), catatan tindak lanjut per perubahan (teks), tampilan pipeline (kolom per status) di /admin/partnership-inquiries. Transisi bebas maju/mundur kecuali dari Selesai/Tidak dilanjutkan (perlu alasan). Data pribadi tetap terenkripsi seperti sekarang.

- [x] Migrasi pemetaan status diuji terhadap DB berisi baris
- [x] Test unggah proposal privat
- [x] Test PIC + catatan tercatat di riwayat

## Catatan 2026-11-09

- **Status**: enum `PartnershipInquiryStatus` dibuat ulang (Postgres tidak bisa memetakan ulang nilai enum di tempat): `NEW` (Baru), `CONTACTED` (Dihubungi), `PROPOSAL`, `NEGOTIATION`, `APPROVED`, `ONGOING`, `DONE` (Selesai), `DROPPED` (Tidak dilanjutkan). Pemetaan di Inquiry dan di riwayatnya (`fromStatus`/`toStatus`): NOT_YET_FOLLOWED_UP -> NEW, IN_PROGRESS -> CONTACTED, DONE -> DONE. Default baru `NEW`.
- **Kolom baru** `PartnershipInquiry`: `budgetRange` (enum 4 rentang), `periodStart`/`periodEnd` ("YYYY-MM", keduanya atau tidak sama sekali), `companyAddress*` dan `companyNpwp*` (ciphertext saja, tanpa HMAC, AAD sendiri; NPWP disimpan sebagai 15 atau 16 digit), `picId` (User, `SetNull`). Riwayat (`PartnershipInquiryStatusChange`): `note` (<= 1000), `picChanged`, `picFromId`, `picToId`. Satu permintaan = satu entri riwayat.
- **Proposal**: `Document.partnershipInquiryId` (pemilik keempat; `Document_one_owner` ditulis ulang) dan `Document.uploadedById` kini nullable karena formulir publik tidak punya akun. PDF saja (dicek byte-nya), disegel seperti dokumen lain (tiket 14); ACL: Admin dan pengunggah (anggota Tim CSR), bukan Verifier. Formulir publik dan `/api/csr/inquiries` menerima JSON atau multipart (`src/lib/inquiry-request.ts`); berkas dicek sebelum Inquiry ditulis (dan sebelum hitungan batas global), dan bila penyimpanan gagal sesudah Inquiry ada, Inquiry tetap dan jawaban membawa `proposalStored: false`. Batas laju publik tidak berubah.
- **Aturan pindah** (`updatePartnershipInquiry`, menggantikan `followUpPartnershipInquiry`): bebas maju atau mundur; keluar dari DONE/DROPPED wajib catatan (400). PIC harus pemegang `ADMIN` (400). Permintaan tanpa perubahan 409. Write dipredikat pada status dan PIC yang dibaca.
- **API**: `GET /api/admin/partnership-inquiries` (+ `pics`), `GET` dan `PATCH /api/admin/partnership-inquiries/[id]` (`{status, picId, note}`); 404 literal bagi yang bukan Admin. Halaman `/admin/partnership-inquiries` menjadi pipeline kolom per tahap dengan panel rincian.
- Retensi Tim CSR (`anonymiseExpiredCompanies`) ikut mengosongkan alamat dan NPWP. Perbaikan sampingan: list lama memakai `select` dan `include` sekaligus (ditolak Prisma sungguhan, disembunyikan oleh fake); fake `tests/support/in-memory-inquiry-db.ts` kini menolaknya.
- **Tes**: `src/__tests__/csr-pipeline-migration.test.ts` (DB berisi baris, butuh `TEST_DATABASE_URL`), `src/__tests__/integration/csr-pipeline-real-db.test.ts` (rute sungguhan di Postgres), plus tes unit modul, rute, halaman, dan kedua formulir. `prisma migrate diff` kosong terhadap DB hasil `migrate deploy`.
- Terbuka: halaman anggota Tim CSR belum menampilkan anggaran/periode. Review independen sonnet sudah dilakukan; temuannya diperbaiki di bawah.

## Perbaikan temuan review (2026-11-09)

- **Proposal ikut dihapus saat anonimisasi**: `anonymiseExpiredCompanies` kini menghapus berkas tersegel tiap proposal Inquiry yang dianonimkan (`anonymiseInquiries` di `src/lib/tim-csr.ts`). Pilihan: **baris `Document` dipertahankan, hanya bytes yang dihapus**, karena aturan "dokumen tidak pernah dihapus" (keputusan 03, `src/lib/documents.ts`) berlaku, dan `Document_one_owner` plus `onDelete: Restrict` memang menjaga baris itu. Tidak ada kolom penanda "terhapus" dan skema tidak diubah; `readDocument` sudah menjawab `null` (rute 404) bila berkasnya tidak ada. Berkas dihapus di dalam transaksi sebelum UPDATE, ENOENT diabaikan, jadi dijalankan ulang setelah commit gagal tetap tuntas. Path di luar penyimpanan tidak pernah disentuh (`absoluteStoragePath`).
- **Inquiry formulir publik (tanpa `companyId`)** kini ikut dianonimkan oleh fase `companyRetention` yang sama, 2 tahun (`COMPANY_RETENTION_YEARS`) sejak `createdAt`, per 200 baris per transaksi: kontak, alamat, NPWP, dan proposal. Hasil job menambah `anonymisedInquiryCount`.
- **Jawaban 201 rute publik** hanya `{ inquiry: { id, status, proposalStored } }`, sama dengan rute CSR; tanpa ciphertext, HMAC, atau id kunci.
- **Batas ukuran JSON** rute publik: 64 KiB (`MAX_INQUIRY_JSON_SIZE` di `src/lib/inquiry-request.ts`), dibaca bertahap lewat `readCappedBody`, jawaban 413.
- **Formulir publik dan CSR**: bila `proposalStored: false` dan visitor memilih berkas, tampil pesan bahwa proposal belum tersimpan dan agar dikirim ulang lewat email atau kanal kontak.
- **Tes**: `src/lib/tim-csr.retention.test.ts` (DB tiruan, berkas sungguhan di direktori sementara), kasus baru di `route.test.ts`, kedua tes formulir, dan satu kasus real-DB di `csr-pipeline-real-db.test.ts` (dilewati tanpa `TEST_DATABASE_URL`; belum dijalankan di sesi ini).
