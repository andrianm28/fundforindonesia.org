# 01: Saklar donasi dari panel + mode pemeliharaan

**Blocked by:** None

**Status:** ready-for-agent

**What to build:** Saat ini satu-satunya kill switch pembayaran adalah `NEXT_PUBLIC_DONATIONS_ENABLED` yang di-inline saat build (src/lib/donations.ts), jadi mematikan donasi butuh rebuild. Tambahkan setelan operasional yang dibaca saat request dan diubah Admin dari panel (/admin/operasional):

- **Saklar donasi** (default: hidup). Bila mati, setiap route yang menerima uang (donasi, retry donasi, pendaftaran Volunteer Trip berbayar) menolak 503 dengan pesan yang sama seperti env-off, dan halaman donasi menampilkan pesan donasi ditutup. Env tetap gerbang keras: donasi hanya jalan bila env `true` DAN saklar hidup. Webhook TIDAK ikut dimatikan (pembayaran yang sudah berjalan tetap harus tercatat).
- **Mode pemeliharaan** (default: mati) dengan pesan opsional. Bila hidup, halaman publik menampilkan banner/laman pemeliharaan, semua route tulis non-Admin menolak 503, sementara /admin, /api/admin, webhook, health, dan login tetap jalan.
- Setiap perubahan tercatat (siapa, kapan, nilai lama/baru), disimpan di baris `SiteSetting` key `operations` lewat modul baru, bukan lewat Pengaturan Laman Publik.
- Runbook: perbarui docs/runbooks/restore.md (baris kill switch yang salah tentang PAYMENT_PROVIDER) dan tambah docs/runbooks/insiden.md bagian saklar donasi + mode pemeliharaan.

- [ ] Test: saklar mati -> POST /api/donations 503; env false tetap 503 walau saklar hidup
- [ ] Test: webhook tetap diproses saat saklar mati dan saat pemeliharaan
- [ ] Test: non-Admin tidak bisa membaca/mengubah setelan (404 sesuai keputusan owner)
- [ ] Test: mode pemeliharaan menolak tulis publik, mengizinkan admin + webhook
- [ ] tsc tidak menambah error, test terkait hijau
