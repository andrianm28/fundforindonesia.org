# 08: Data verifikasi penggalang dana

**Blocked by:** 07 (slot skema)

**Status:** done

**What to build:** Pasal 3.2. Tambah butir checklist verifikasi (migrasi data ke VerificationChecklistItem, bisa diubah Admin): foto diri memegang KTP, bukti alamat, hubungan dengan penerima manfaat, surat kuasa (lembaga, bila diperlukan), dokumen pendukung program. Tambah kolom alamat dan identitas penanggung jawab (nama, jabatan, telepon terenkripsi) pada Partner Organisation, diisi Verifier saat mendaftarkan lembaga. Field hubungan dengan penerima manfaat di form Campaign (teks singkat).

- [x] Migrasi data idempoten
- [x] Test form Verifier menyimpan alamat + PJ

## Comments

- Migrasi `20261111080000_data_verifikasi_penggalang`: lima butir checklist "Semua" (kind NULL, `requiresDocument` true, surat kuasa tidak wajib) lewat `INSERT ... ON CONFLICT (id) DO NOTHING` dengan id tetap, jadi aman dijalankan ulang dan tidak menimpa suntingan Admin. Kolom baru `PartnerOrganisation.address`, `responsiblePersonName`, `responsiblePersonTitle`, `responsiblePersonPhoneCiphertext/KeyId` (nullable: organisasi lama belum punya), dan `Campaign.beneficiaryRelationship`.
- Telepon PJ memakai pola ADR 0012 lewat `contact-fields.ts` (AAD `PartnerOrganisation.responsiblePersonPhone`, tanpa HMAC). Jurnal audit memuat alamat, nama, dan jabatan, tidak pernah telepon; perubahan telepon dicatat sebagai `responsiblePersonPhoneChanged: true`. Respons API Verifier lewat `toRegisterView` (ciphertext dibuang, telepon didekripsi untuk Verifier).
- Pendaftaran baru mewajibkan alamat, nama, jabatan, dan telepon PJ (format Indonesia). Organisasi lama dilengkapi lewat kartu "Alamat dan Penanggung Jawab" di daftar Verifier (PATCH yang sudah ada).
- Hubungan dengan penerima manfaat: teks maks 200 karakter, bagian dari `campaignLocationSchema` (POST, PATCH, form buat dan ubah). Sengaja tidak ada di GET publik `/api/campaigns/[slug]`; Verifier melihatnya di halaman moderasi kampanye.
- Keputusan terbuka: butir checklist baru wajib untuk semua Kind, jadi Draft yang belum diajukan perlu mengunggah lima dokumen (empat wajib) sebelum Verifier dapat mencentang. Bila owner ingin sebagian hanya untuk perorangan atau lembaga, itu perubahan data lewat panel Admin.
