# 15: Aamiin anti-ganda + beranda kurasi manual

**Blocked by:** 12 (slot skema)

**Status:** done

**What to build:** Pasal 3.7(5)–(6), BERSYARAT, owner memutuskan dikerjakan (2026-11-09). (a) Aamiin: tabel per (doa, penanda) dengan unik; penanda = user id bila login, atau id anonim stabil dari cookie bertanda tangan bila tamu; `amiinCount` hanya naik bila baris baru; klien menampilkan status sudah-Aamiin. (b) Beranda kurasi: Admin menandai Campaign sebagai 'Pilihan' dan 'Unggulan kategori' (per kategori), serta menandai doa untuk 'Sorotan doa'; beranda memakai penandaan ini (urutan manual), jatuh ke perilaku otomatis sekarang bila belum ada penandaan. Penandaan tercatat siapa dan kapan.

- [x] Test: Aamiin kedua oleh penanda yang sama tidak menambah
- [x] Test: beranda memakai penandaan, fallback otomatis
- [x] Layar Admin kurasi, non-Admin 404

## Catatan (2026-11-09)

Pilihan desain:
- **Aamiin**: tabel `AamiinMark` unik (doa, penanda). Penanda `u:<userId>` bila login, `a:<idAnonim>` bila tamu; id anonim ada di cookie `ffi_aamiin` (HttpOnly, 400 hari) bertanda tangan HMAC lewat codec token yang sudah ada (`result-token-codec`, kunci turunan dari `NEXTAUTH_SECRET`), jadi tidak ada env baru. Cookie rusak/palsu diperlakukan sebagai tamu baru. Batas yang diterima: tamu yang menghapus cookie bisa memberi Aamiin lagi.
- Rute Aamiin: satu transaksi, `createMany({skipDuplicates})` (INSERT ... ON CONFLICT DO NOTHING) lalu, hanya bila baris baru, `prayer.updateMany({ where: { id, ...publicPrayerWhere() }, data: { amiinCount: { increment: 1 } } })`. Bila count 0 (doa disembunyikan/dihapus di tengah jalan) transaksi di-rollback dan jawabannya 404 (permintaan koordinator dari review tiket 10). Respons memuat `alreadyAamiin`. Doa lama tidak punya baris penanda, hitungannya tetap. Batas laju: rute ini memang belum punya, tidak ada yang diubah.
- Klien: `GET /api/prayers/aamiin-status?ids=` (tidak di-cache) memberi tahu doa mana yang sudah di-Aamiin pengunjung; hook bersama `useAamiin` dipakai `PrayerWall` dan `CampaignPrayers`; tombol menjadi "Sudah Aamiin" (nonaktif) dan jumlah memakai angka server.
- **Kurasi**: `CampaignFeature` (kind `PILIHAN` / `UNGGULAN_KATEGORI`, unik per campaign+kind, `position`) dan `PrayerHighlight` (unik per doa). "Unggulan kategori" berlaku untuk kategori milik Campaign itu sendiri. `markedById` teks biasa (bukan FK) agar catatan siapa bertahan; `markedAt` dicatat. Admin mengirim seluruh daftar berurutan per slot (`PUT /api/admin/kurasi`, maks 50); tanda yang tetap mempertahankan siapa/kapan aslinya.
- Beranda: Pilihan Kami memakai tanda yang lolos aturan publik (`listable`, jadi hanya Campaign aktif dan tidak demo); jatuh ke urutan otomatis bila tidak ada tanda yang tampil. Bagian baru "Unggulan {kategori}" dan "Sorotan Doa" hanya muncul bila ada isinya; Sorotan doa dibaca lewat `publicPrayerWhere` (dipasang di properti `prayer-public-readers`).
- Layar `/admin/kurasi` (di balik layout Admin, tautan di sidebar) dan API `GET`/`PUT /api/admin/kurasi` lewat `withHiddenAssignmentCheck(ADMIN)`: non-Admin 404, belum login 401. Allowlist `roles-expand-guard` dan `prayer-public-readers` diperbarui dengan alasan.
- Migrasi `20261111150000_aamiin_anti_ganda_kurasi_beranda`: diff `prisma migrate diff` kosong terhadap Postgres lokal; tes `aamiin-kurasi-migration.test.ts` memakai database sungguhan (termasuk dua koneksi berlomba pada penanda yang sama).
