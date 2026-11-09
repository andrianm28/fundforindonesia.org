# 01: Saklar donasi dari panel + mode pemeliharaan

**Blocked by:** None

**Status:** done

**What to build:** Saat ini satu-satunya kill switch pembayaran adalah `NEXT_PUBLIC_DONATIONS_ENABLED` yang di-inline saat build (src/lib/donations.ts), jadi mematikan donasi butuh rebuild. Tambahkan setelan operasional yang dibaca saat request dan diubah Admin dari panel (/admin/operasional):

- **Saklar donasi** (default: hidup). Bila mati, setiap route yang menerima uang (donasi, retry donasi, pendaftaran Volunteer Trip berbayar) menolak 503 dengan pesan yang sama seperti env-off, dan halaman donasi menampilkan pesan donasi ditutup. Env tetap gerbang keras: donasi hanya jalan bila env `true` DAN saklar hidup. Webhook TIDAK ikut dimatikan (pembayaran yang sudah berjalan tetap harus tercatat).
- **Mode pemeliharaan** (default: mati) dengan pesan opsional. Bila hidup, halaman publik menampilkan banner/laman pemeliharaan, semua route tulis non-Admin menolak 503, sementara /admin, /api/admin, webhook, health, dan login tetap jalan.
- Setiap perubahan tercatat (siapa, kapan, nilai lama/baru), disimpan di baris `SiteSetting` key `operations` lewat modul baru, bukan lewat Pengaturan Laman Publik.
- Runbook: perbarui docs/runbooks/restore.md (baris kill switch yang salah tentang PAYMENT_PROVIDER) dan tambah docs/runbooks/insiden.md bagian saklar donasi + mode pemeliharaan.

- [x] Test: saklar mati -> POST /api/donations 503; env false tetap 503 walau saklar hidup
- [x] Test: webhook tetap diproses saat saklar mati dan saat pemeliharaan
- [x] Test: non-Admin tidak bisa membaca/mengubah setelan (404 sesuai keputusan owner)
- [x] Test: mode pemeliharaan menolak tulis publik, mengizinkan admin + webhook
- [x] tsc tidak menambah error, test terkait hijau

## Comments

- Modul baru `src/lib/operations.ts`: satu baris `SiteSetting` key `operations` (donationsOpen, maintenance{on,message}, history 50 terakhir: siapa/kapan/nilai lama-baru). Tanpa migrasi; `site-settings.ts` tidak mengenal key ini, jadi rute Laman Publik tidak bisa menulisnya.
- Saklar donasi dicek di POST /api/donations, retryDonationPayment, dan registrasi Volunteer Trip, SETELAH gerbang env dan interlock sandbox (hanya menambah syarat). Gagal baca = tertutup. Webhook tidak menyentuhnya (ada tes yang menjaga).
- Mode pemeliharaan ditegakkan di `src/proxy.ts` (matcher baru `/api/:path*`): tulis non-Admin ke /api ditolak 503 + Retry-After; dikecualikan /api/admin, webhooks, health, auth, internal, client-error. Gagal baca = lolos. Banner di root layout; halaman donasi lewat `donate/layout.tsx` server.
- Admin: `/admin/operasional` + `/api/admin/operations` (GET/POST), non-Admin 404 literal untuk baca maupun ubah.
- Mock prisma pada tes rute donasi lain ditambah `siteSetting` karena saklar gagal-tertutup.
- Belum: tombol coba bayar ulang di `/donasi/hasil/[token]` masih tampil saat saklar mati (rute tetap 503). Update setelan baca-lalu-tulis tanpa kunci; dua Admin serentak bisa menimpa satu entri riwayat (risiko rendah).
- Tinjau mandiri (code-review inline; builder tak bisa men-dispatch subagent): satu temuan, impor ganda operations di proxy, sudah dirapikan. Review independen sonnet tetap perlu (kode uang).
