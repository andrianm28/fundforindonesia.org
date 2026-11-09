# 14: Enkripsi berkas dokumen privat saat disimpan

**Blocked by:** None

**Status:** done

**What to build:** Kontrak 10(4) 'Penyimpanan berkas, enkripsi, retensi' (WAJIB). Dokumen privat (src/lib/documents.ts) disimpan polos di volume. Enkripsi isi berkas dengan AES-256-GCM memakai keyring field-encryption yang ada saat ditulis, dekripsi saat dibaca lewat route yang sudah ber-ACL. Berkas lama tetap terbaca (deteksi header) dan skrip migrasi opsional mengenkripsi berkas lama. Tidak ada perubahan skema kecuali benar-benar perlu.

- [x] Test round-trip, tamper ditolak, berkas lama tetap terbaca
- [x] Review independen sonnet (keamanan)

## Comments

- Disegel di `src/lib/document-encryption.ts`: magic `FFIDOC1\0` | panjang id | key id | iv | ciphertext | tag. Key = `FIELD_ENCRYPTION_KEY` (keyring ADR 0012, termasuk key pensiun), AAD `Document.file:<storagePath>` supaya berkas sah tidak bisa ditukar ke dokumen lain dan terpisah dari kolom kontak. `FieldKeys` mendapat `encryptBytes`/`decryptBytes`; tanpa perubahan skema.
- Validasi magic byte tetap jalan pada plaintext sebelum penyegelan. Upload tanpa key: 503, tidak pernah menulis polos. Baca: berkas tanpa header disajikan apa adanya; berkas bersegel yang gagal verifikasi melempar, route menjawab 500 (berkas hilang tetap 404).
- Skrip `scripts/encrypt-existing-documents.ts` (idempoten, temp + rename) menyegel berkas lama; opsional. Langkah owner di server: backup volume lalu jalankan skrip (lihat runbook `rotasi-kunci-field.md`). Tidak ada env baru.
- Unggahan publik (`src/lib/uploads.ts`, sampul campaign) di luar cakupan: publik by design, tetap tidak disegel.
- Batas: yang punya akses tulis ke volume bisa menanam berkas tanpa header (disajikan polos); enkripsi ini melindungi disk/backup yang tersalin, bukan host yang dibobol.
