# 56: Flag untuk menampilkan Demo Campaign di katalog sebelum launch

**Status:** awaiting-merge

**Blocked by:** none

Keputusan owner 2026-10-03, setelah cutover produksi ke repo ini: situs tampak
kosong. Semua Campaign era kibi-clone berisi data fiktif dan sudah ditandai
`isDemo` oleh migrasi `20260917163016_mark_demo_campaigns`, sementara aturan
Demo Campaign (`CONTEXT.md`) mengecualikannya dari katalog, pencarian, sitemap,
dan Impact. Seed ulang tidak dipakai: `prisma/seed.ts` menolak database yang
sudah berisi Campaign dan membuat akun Admin dengan password yang diketahui
publik.

Owner memilih sebuah env flag, off secara default, yang selama masa sebelum
launch menampilkan Demo Campaign di katalog dengan lencananya.

- [x] Env flag server-side (mis. `SHOW_DEMO_CAMPAIGNS`, aktif hanya bila
      bernilai persis `"true"`, pola yang sama dengan `NEXT_PUBLIC_DONATIONS_ENABLED`)
      membuat Demo Campaign ikut tampil di beranda, katalog/explore, dan
      pencarian; tanpa flag perilaku tidak berubah
- [x] Demo Campaign yang tampil selalu membawa lencana Demo di kartu dan di
      halamannya
- [x] Yang TIDAK berubah walau flag aktif: Donation dan Payout tetap ditolak,
      Impact dan semua hitungan uang/abuse/dormant tetap mengecualikannya,
      sitemap tetap tidak mencantumkannya
- [x] Satu tempat yang memutuskan "tampil di katalog publik" dipakai semua
      pembaca katalog, bukan flag yang diperiksa di tiap halaman
- [x] `.env.example` dan entri Demo Campaign di `CONTEXT.md` menyebut flag ini
- [x] Tes untuk flag aktif dan tidak aktif

## Comments

- 2026-10-03, `claude/prd-56-show-demo-campaigns`: `showDemoCampaigns()` dan `catalogueDemoWhere()` di `src/lib/subject-guard.ts` jadi satu-satunya penentu; `listableCampaignWhere` (home, explore/[category], /api/campaigns untuk explore/all dan search, zakat) mengikutinya, begitu pula filter Prayer Wall (beranda dan /api/prayers). `NOT_A_DEMO_CAMPAIGN` dan `sitemapCampaignWhere` tidak disentuh, jadi uang/Impact/abuse/dormant/sitemap/Donation/Payout tetap mengecualikan. Flag dibaca dari `process.env` saat request (bukan NEXT_PUBLIC_); semua halaman terdampak sudah dinamis (home dan explore/[category] `force-dynamic`, API membaca `request.url`), jadi tidak ada render statis saat build. Lencana sudah ada di CampaignCard/CampaignDetailView. Flag diteruskan ke container lewat kedua berkas docker-compose. Full suite hijau, ratchet lint 193 / tsc 19. Commit: SHA_PLACEHOLDER
