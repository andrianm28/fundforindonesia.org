# 17: Modul kolaborasi CSR lengkap

**Blocked by:** 15 (slot skema)

**Status:** ready-for-agent

**What to build:** Pasal 3.6, BERSYARAT, owner memutuskan dikerjakan. Formulir kolaborasi (publik dan akun Tim CSR) menambah: kisaran anggaran (pilihan rentang), periode (mulai-selesai bulan), unggah proposal (Document privat, PDF), alamat dan NPWP perusahaan (opsional). Status prospek menjadi 8: Baru, Dihubungi, Proposal, Negosiasi, Disetujui, Berjalan, Selesai, Tidak dilanjutkan (migrasi memetakan 3 status lama: NOT_YET_FOLLOWED_UP->Baru, IN_PROGRESS->Dihubungi, DONE->Selesai). Admin: tetapkan PIC (pengguna Admin), catatan tindak lanjut per perubahan (teks), tampilan pipeline (kolom per status) di /admin/partnership-inquiries. Transisi bebas maju/mundur kecuali dari Selesai/Tidak dilanjutkan (perlu alasan). Data pribadi tetap terenkripsi seperti sekarang.

- [ ] Migrasi pemetaan status diuji terhadap DB berisi baris
- [ ] Test unggah proposal privat
- [ ] Test PIC + catatan tercatat di riwayat
