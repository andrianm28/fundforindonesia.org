# 09: Kampanye: galeri, pernyataan kebenaran data, label status, riwayat status

**Blocked by:** 08 (slot skema)

**Status:** done

**What to build:** Pasal 3.3–3.4. (a) Galeri terbatas: maksimal 6 gambar per Campaign, pakai validasi unggahan yang ada. (b) Centang wajib 'pernyataan kebenaran data' saat mengajukan, disimpan dengan waktu. (c) Label status sesuai kontrak: SUSPENDED tampil 'Ditangguhkan'; REJECTED yang masih bisa diajukan ulang tampil 'Perlu revisi', ditolak final tampil 'Ditolak' (tambah penanda final pada aksi tolak); tampilkan 'Disetujui' di riwayat saat Verifier menyetujui. (d) Layar riwayat status (CampaignStatusChange) di halaman moderasi dan admin Campaign.

- [x] Test label untuk setiap status
- [x] Test galeri batas 6
- [x] Test pengajuan tanpa pernyataan ditolak

## Comments

- Migrasi `20261111090000_kampanye_galeri_pernyataan_penolakan_final`: hanya menambah kolom. `Campaign.galleryImages TEXT[]` (default kosong) dengan CHECK `cardinality <= 6` di database selain batas aplikasi (`galleryImagesSchema`), `Campaign.rejectionFinal` dan `CampaignStatusChange.final` (boolean, default false), `VerificationRequest.truthStatementAcceptedAt` (nullable; pengajuan lama tidak punya). Diterapkan ke Postgres kosong baru: `migrate diff` kosong. (Postgres bersama `ffi` sudah menyimpang dari skema karena migrasi tiket 04 versi lama; dipakai DB sendiri `ffi_t09`.)
- Galeri memakai `/api/upload` yang sama dengan sampul (sniffing byte di `src/lib/uploads.ts`, bukan tipe klien) dan `coverImageSchema` per elemen, tanpa duplikat. Diunggah saat form disimpan (`useGalleryDraft`), bukan saat dipilih. Halaman publik menyaring lagi dengan `isValidCoverImage` saat render. GET publik `/api/campaigns/[slug]` hanya menambah `galleryImages`; daftar publik `/api/campaigns` sekarang `omit` `beneficiaryRelationship` dan `rejectionFinal` (celah tiket 08 ikut tertutup).
- Pernyataan kebenaran data disimpan per Verification Request (bukan per Campaign), jadi tiap pengajuan ulang punya waktu centang sendiri. `submitCampaign` menolak (400 VALIDATION) bila `truthStatement !== true`, sebelum membaca apa pun; centang ada di wizard buat, form edit, dan daftar Galang Dana Saya. Waktunya tampil bagi Verifier di halaman moderasi.
- Tolak final: `final: true` pada PATCH moderasi (hanya berlaku untuk penolakan SUBMISSION). Campaign tetap REJECTED, `rejectionFinal` dan `CampaignStatusChange.final` diset, `submitCampaign` menolak 409 (`RejectedForGoodError`, kode INVALID_TRANSITION), form edit dan tombol ajukan disembunyikan, notifikasi dan email tidak lagi menyuruh mengajukan ulang. Label: REJECTED = "Perlu revisi", final = "Ditolak", SUSPENDED = "Ditangguhkan". Riwayat membaca "Disetujui" untuk SUBMISSION_APPROVED.
- Riwayat status (`loadCampaignStatusHistory` + `CampaignStatusHistory`) hanya dirender di halaman moderasi (Verifier) dan halaman lifecycle Admin; tidak ada route atau halaman baru, jadi allowlist property test tidak berubah. Tidak ada env var baru.
- Keputusan terbuka: (1) judul notifikasi Suspension di `campaign-lifecycle.ts` ("Campaign Dibekukan") dan label Volunteer Trip ("Dibekukan") sengaja tidak diubah; kontrak hanya menyebut label status Campaign. (2) `src/__tests__/integration/auth-notifications.test.ts` gagal dua tes sejak tiket 07 (registrasi mewajibkan `acceptTerms`), bukan akibat tiket ini.
