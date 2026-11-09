# 08: Data verifikasi penggalang dana

**Blocked by:** 07 (slot skema)

**Status:** done

**What to build:** Pasal 3.2. Tambah butir checklist verifikasi (migrasi data ke VerificationChecklistItem, bisa diubah Admin): foto diri memegang KTP, bukti alamat, hubungan dengan penerima manfaat, surat kuasa (lembaga, bila diperlukan), dokumen pendukung program. Tambah kolom alamat dan identitas penanggung jawab (nama, jabatan, telepon terenkripsi) pada Partner Organisation, diisi Verifier saat mendaftarkan lembaga. Field hubungan dengan penerima manfaat di form Campaign (teks singkat).

- [x] Migrasi data idempoten
- [x] Test form Verifier menyimpan alamat + PJ
- [x] Review independen sonnet (uang tidak ada; keamanan data pribadi dan migrasi), temuan ditindaklanjuti

## Comments

- Migrasi `20261111080000_data_verifikasi_penggalang`: lima butir checklist "Semua" (kind NULL, `requiresDocument` true, surat kuasa tidak wajib) lewat `INSERT ... ON CONFLICT (id) DO NOTHING` dengan id tetap, jadi aman dijalankan ulang dan tidak menimpa suntingan Admin. Kolom baru `PartnerOrganisation.address`, `responsiblePersonName`, `responsiblePersonTitle`, `responsiblePersonPhoneCiphertext/KeyId` (nullable: organisasi lama belum punya), dan `Campaign.beneficiaryRelationship`.
- Telepon PJ memakai pola ADR 0012 lewat `contact-fields.ts` (AAD `PartnerOrganisation.responsiblePersonPhone`, tanpa HMAC). Jurnal audit memuat alamat, nama, dan jabatan, tidak pernah telepon; perubahan telepon dicatat sebagai `responsiblePersonPhoneChanged: true`. Respons API Verifier lewat `toRegisterView` (ciphertext dibuang, telepon didekripsi untuk Verifier).
- Pendaftaran baru mewajibkan alamat, nama, jabatan, dan telepon PJ (format Indonesia). Organisasi lama dilengkapi lewat kartu "Alamat dan Penanggung Jawab" di daftar Verifier (PATCH yang sudah ada).
- Hubungan dengan penerima manfaat: teks maks 200 karakter, bagian dari `campaignLocationSchema` (POST, PATCH, form buat dan ubah). Sengaja tidak ada di GET publik `/api/campaigns/[slug]`; Verifier melihatnya di halaman moderasi kampanye.
- Tindak lanjut review independen: lima butir checklist hanya di-snapshot untuk permintaan SUBMISSION. Tidak ada mekanisme cakupan jenis permintaan maupun jenis penggalang, jadi migrasi menambah dua kolom pada `VerificationChecklistItem`: `requestKinds VerificationRequestKind[]` (default ketiganya, sehingga butir lama tidak berubah) dan `applicant ChecklistApplicant?` (`INDIVIDUAL`, `ORGANISATION`, atau NULL untuk keduanya). Tanpa ini butir wajib berdokumen ikut ter-snapshot ke CHANGE dan AMOUNT_REVIEW kampanye live yang disetujui sebelum butir itu ada, dan permintaannya tidak dapat disetujui. "Foto diri memegang KTP" hanya untuk perorangan, "surat kuasa" hanya untuk akun organisasi (penggalang yang punya Partner Organisation), tiga lainnya untuk keduanya. Panel Admin belum menampilkan dua kolom ini; mengubahnya masih lewat data.
- Telepon PJ yang sama dengan nilai sekarang (dibandingkan dengan hasil dekripsi) tidak ditulis ulang, dan tidak dicatat sebagai "telepon berubah". Input telepon dibatasi 300 karakter seperti `cleanText`. Kartu "Alamat dan Penanggung Jawab" kini menandai data belum lengkap bila salah satu dari alamat, nama, jabatan, atau telepon PJ kosong.
- Retensi: PartnerOrganisation tidak pernah dihapus, jadi anonimisasi ADR 0023 tidak berlaku untuk kolom alamat dan penanggung jawab ini (alamat, nama, jabatan, telepon terenkripsi). Bila kebijakan itu berubah, kolom-kolom ini harus masuk daftar anonimisasi.
- Tes migrasi (`verification-data-migration.test.ts`) kini menjalankan SQL-nya terhadap `TEST_DATABASE_URL` pada database yang sudah berisi checklist dan organisasi, bukan regex atas teks SQL.
