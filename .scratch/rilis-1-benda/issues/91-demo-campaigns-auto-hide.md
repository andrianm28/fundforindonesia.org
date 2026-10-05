# 91: A-8 demo-campaigns-auto-hide

**Status:** ready-for-agent

**Blocked by:** none. Menyentuh `src/lib/subject-guard.ts`; jangan paralel dengan builder lain di berkas itu.

**Ukuran:** S

**Catatan:** Tanpa skema yang diketahui. `CONTEXT.md` (entri Demo Campaign) diedit koordinator, bukan builder.

## Latar

Keputusan owner 2026-10-04 (ronde C, C19): Demo Campaign disembunyikan **otomatis**, bukan lewat flip manual `SHOW_DEMO_CAMPAIGNS=false` pada langkah A6. Rekomendasi awal (flip manual) **ditolak**. PRD §11 baris Fase 1 sudah berbunyi "Demo Campaign disembunyikan dari katalog dan Impact saat Campaign nyata pertama Active".

Hari ini Demo Campaign tidak pernah masuk katalog, pencarian, sitemap, atau hitungan Impact, kecuali flag server-side `SHOW_DEMO_CAMPAIGNS` (aktif hanya bila persis `"true"`) membuatnya ikut tampil di beranda, katalog, dan pencarian (`catalogueDemoWhere` dan `listableCampaignWhere` di `src/lib/subject-guard.ts`). Sebelum ada Campaign nyata, Demo Campaign dipertahankan agar situs tidak kosong; begitu ada satu Campaign nyata Active, Demo Campaign tidak boleh lagi tampil.

## Berkas relevan

- `src/lib/subject-guard.ts` (`catalogueDemoWhere`, `listableCampaignWhere`, `NOT_A_DEMO_CAMPAIGN`)
- `src/app/page.tsx`, `src/app/api/campaigns/route.ts` dan tes listing (`route.listing.test.ts`, `subject-guard.listing.test.ts`)
- `src/lib/money/impact.ts` (halaman Impact)
- `.env.example` (hanya koordinator)
- `.scratch/prd-compliance-fase-0-2/issues/56-show-demo-campaigns-flag.md` (PR #215; asal flag)
- `CONTEXT.md` (Demo Campaign)

## Acceptance

- [ ] Selama **belum ada** Campaign nyata (`isDemo: false`) berstatus Active, perilaku sekarang tidak berubah (flag tetap mengatur apakah Demo Campaign tampil)
- [ ] Begitu ada satu Campaign nyata Active, Demo Campaign **hilang** dari katalog, pencarian, dan beranda, dan tidak masuk hitungan Impact, tanpa mengubah env atau deploy ulang
- [ ] `SHOW_DEMO_CAMPAIGNS` tetap sebagai **penimpa manual**: bila persis `"true"`, Demo Campaign tetap tampil walau sudah ada Campaign nyata Active (untuk keperluan uji di staging)
- [ ] Demo Campaign tetap ditolak menerima Donation dan Payout, halamannya tetap terbuka lewat tautan dengan lencananya, dan Admin tetap melihatnya; yang berubah hanya daftar yang dilihat pengunjung
- [ ] Bila Campaign nyata terakhir yang Active keluar dari Active (Completed, Expired, Suspended), diputuskan dan dicatat di PR apakah Demo Campaign muncul kembali; default usulan: ikut keadaan saat ini (tampil kembali hanya bila tidak ada Campaign nyata Active), tanpa status yang disimpan
- [ ] Penentuan "Campaign nyata Active" memakai kolom `isDemo` dan status efektif yang sudah ada, bukan nama, slug, atau daftar Campaign tertentu
- [ ] Tes: tanpa Campaign nyata (tampil sesuai flag), dengan satu Campaign nyata Active (tersembunyi), dengan flag `true` (tampil), dan Impact; ratchet lint dan tsc tidak naik

## Comments

- 2026-10-04 (ronde C): ditulis koordinator dari keputusan owner C19 (`percepatan-full-rilis/keputusan-ronde-c.md`). Langkah A6 di `plan.md` tidak lagi memerlukan flip `SHOW_DEMO_CAMPAIGNS`. Menyimpang dari rekomendasi, atas keputusan owner.
