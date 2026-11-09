# 14: Enkripsi berkas dokumen privat saat disimpan

**Blocked by:** None

**Status:** ready-for-agent

**What to build:** Kontrak 10(4) 'Penyimpanan berkas, enkripsi, retensi' (WAJIB). Dokumen privat (src/lib/documents.ts) disimpan polos di volume. Enkripsi isi berkas dengan AES-256-GCM memakai keyring field-encryption yang ada saat ditulis, dekripsi saat dibaca lewat route yang sudah ber-ACL. Berkas lama tetap terbaca (deteksi header) dan skrip migrasi opsional mengenkripsi berkas lama. Tidak ada perubahan skema kecuali benar-benar perlu.

- [ ] Test round-trip, tamper ditolak, berkas lama tetap terbaca
- [ ] Review independen sonnet (keamanan)
