# 09: Kampanye: galeri, pernyataan kebenaran data, label status, riwayat status

**Blocked by:** 08 (slot skema)

**Status:** ready-for-agent

**What to build:** Pasal 3.3–3.4. (a) Galeri terbatas: maksimal 6 gambar per Campaign, pakai validasi unggahan yang ada. (b) Centang wajib 'pernyataan kebenaran data' saat mengajukan, disimpan dengan waktu. (c) Label status sesuai kontrak: SUSPENDED tampil 'Ditangguhkan'; REJECTED yang masih bisa diajukan ulang tampil 'Perlu revisi', ditolak final tampil 'Ditolak' (tambah penanda final pada aksi tolak); tampilkan 'Disetujui' di riwayat saat Verifier menyetujui. (d) Layar riwayat status (CampaignStatusChange) di halaman moderasi dan admin Campaign.

- [ ] Test label untuk setiap status
- [ ] Test galeri batas 6
- [ ] Test pengajuan tanpa pernyataan ditolak
