# 03: Baca publik

**Blocked by:** 01

**Status:** needs-triage

- [ ] Daftar dan detail Campaign, kategori, Pengaturan Laman Publik, sitemap, OG image, halaman program, beranda pindah ke `db`.
- [ ] Bentuk data ke komponen tidak berubah (null vs undefined, `Date`).
- [ ] Koordinasi dengan PR #347 (sitemap revalidate) bila belum merge.
- [ ] Termasuk `src/lib/home/home-page-data.ts` (cache beranda 30 detik dari thread riset stack ringan), bila sudah di main.
- [ ] Waspadai konflik di `src/proxy.ts` (CSP nonce dari thread yang sama).
