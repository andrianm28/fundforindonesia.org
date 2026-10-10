# 91: A-8 demo-campaigns-auto-hide

**Status:** awaiting-merge

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

- [x] Selama **belum ada** Campaign nyata (`isDemo: false`) berstatus Active, perilaku sekarang tidak berubah (flag tetap mengatur apakah Demo Campaign tampil): `true` tampil, kosong/`false`/nilai lain tersembunyi seperti sekarang, `auto` tampil
- [x] Begitu ada satu Campaign nyata Active, Demo Campaign **hilang** dari katalog, pencarian, dan beranda, dan tidak masuk hitungan Impact, tanpa mengubah env atau deploy ulang: berlaku pada `SHOW_DEMO_CAMPAIGNS=auto` (lihat Comments untuk alasan nilai ini dan tindakan owner); Impact memang tidak pernah menghitung Demo Campaign
- [x] `SHOW_DEMO_CAMPAIGNS` tetap sebagai **penimpa manual**: bila persis `"true"`, Demo Campaign tetap tampil walau sudah ada Campaign nyata Active (untuk keperluan uji di staging)
- [x] Demo Campaign tetap ditolak menerima Donation dan Payout, halamannya tetap terbuka lewat tautan dengan lencananya, dan Admin tetap melihatnya; yang berubah hanya daftar yang dilihat pengunjung
- [x] Bila Campaign nyata terakhir yang Active keluar dari Active (Completed, Expired, Suspended), diputuskan dan dicatat di PR apakah Demo Campaign muncul kembali; default usulan: ikut keadaan saat ini (tampil kembali hanya bila tidak ada Campaign nyata Active), tanpa status yang disimpan: diputuskan mengikuti default usulan, tampil kembali pada `auto`
- [x] Penentuan "Campaign nyata Active" memakai kolom `isDemo` dan status efektif yang sudah ada, bukan nama, slug, atau daftar Campaign tertentu
- [x] Tes: tanpa Campaign nyata (tampil sesuai flag), dengan satu Campaign nyata Active (tersembunyi), dengan flag `true` (tampil), dan Impact; ratchet lint dan tsc tidak naik

## Comments

- 2026-10-04 (ronde C): ditulis koordinator dari keputusan owner C19 (`percepatan-full-rilis/keputusan-ronde-c.md`). Langkah A6 di `plan.md` tidak lagi memerlukan flip `SHOW_DEMO_CAMPAIGNS`. Menyimpang dari rekomendasi, atas keputusan owner.

- 2026-10-10, branch `claude/rilis-1-91-demo-campaigns-auto-hide`, sha kode d24f72e:
  - **Arti nilai `SHOW_DEMO_CAMPAIGNS`** (dipilih builder; owner perlu mengesahkan), masing-masing hanya bila persis: `true` = paksa tampil (penimpa manual, perilaku lama); `auto` = tampil hanya selama belum ada Campaign nyata (`isDemo: false`) yang efektif Active, sembunyi sejak ada satu; selain itu (tidak diisi, kosong, `false`, salah ketik seperti `TRUE` atau `AUTO`) = tidak pernah tampil, perilaku lama. Alasan `auto` harus ditulis eksplisit dan kosong tidak otomatis: keputusan owner 2026-10-03 "off secara default" tetap berlaku, tak ada nilai lama yang berubah arti, dan `docker-compose.yml` serta `docker-compose.prod.yml` mengubah nilai kosong menjadi `false` (`${SHOW_DEMO_CAMPAIGNS:-false}`) sehingga "kosong = otomatis" tak akan pernah sampai ke container. Tiga butir acceptance 1 sampai 3 tidak bisa semuanya benar untuk satu nilai (`true` tak mungkin sekaligus penimpa dan otomatis), jadi otomatis diberi nilainya sendiri.
  - **Tindakan owner (bukan kode):** produksi kemungkinan besar masih `SHOW_DEMO_CAMPAIGNS=true` (disimpulkan dari langkah A6 lama dan tiket 56; builder tidak melihat produksi), dan `true` kini penimpa; ganti ke `auto` sekali saat 91 ter-deploy, kalau tidak Demo Campaign tidak pernah hilang sendiri. Dengan `auto`, situs tetap berisi Demo Campaign sampai Campaign nyata pertama Active, lalu hilang tanpa flip pada langkah A6. Langkah A6 di `plan.md` perlu disesuaikan (bukan flip ke `false`, melainkan set `auto` sebelum itu).
  - **Campaign nyata terakhir keluar dari Active:** mengikuti default usulan; Demo Campaign tampil kembali (pada `auto`), tanpa status tersimpan, karena jawabannya dibaca dari data pada tiap permintaan. Diuji untuk Completed, Suspended, dan Active yang tenggatnya lewat.
  - **Implementasi:** `showDemoCampaigns(db, now)`, `catalogueDemoWhere(db, now, options)` dan `listableCampaignWhere(db, now, options)` di `src/lib/subject-guard.ts` kini async dan menerima `db` sebagai argumen pertama. Mode `auto` memakai satu `findFirst` yang hanya memilih `id` (`LIMIT 1`, indeks `Campaign_lifecycleStatus_deadline_idx`); mode lain tidak membaca apa pun, dan pemanggil yang sudah memutuskan (`includeDemo`) juga tidak. Beranda memutuskan sekali lalu meneruskan `includeDemo` ke tiga daftar dan Prayer Wall, jadi satu baca per render. Definisi Active efektif tidak ditulis ulang: klausanya diekstrak menjadi `effectivelyActiveWhere` dan dipakai bersama oleh `listableCampaignWhere` dan pengecekan "ada Campaign nyata Active". Pengecekan itu global (semua Kind dan Category), jadi satu keputusan berlaku untuk semua daftar. Layar Admin `AssignCollectingEntityScreen` (`includeDemo: true`) tidak berubah dan tidak membaca.
  - **Tidak diubah, sengaja:** `impactBreakdown` (`src/lib/money/impact.ts`) sudah mengecualikan `isDemo: false` tanpa syarat, jadi Impact tak mengikuti flag sama sekali; tes ditambah untuk `true`, `auto`, dan `false`. Penolakan Donation dan Payout, halaman Campaign, sitemap, pengingat terjadwal (tiket 61), dormant, abuse: tak disentuh. Tes statik (`public-listings-effective-status.test.ts`) kini memastikan hanya tujuh berkas yang boleh menanyakan keputusan ini dan bahwa tiap pemanggil `await`-nya (guard yang lupa di-`await` lalu di-spread akan menghapus kedua aturan tanpa peringatan TypeScript).
  - **Catatan:** cache `/api/campaigns` (`s-maxage=60` plus `stale-while-revalidate=300`) membuat daftar API bisa tertinggal beberapa menit setelah Campaign nyata pertama Active; beranda `force-dynamic` tidak. Halaman `explore/[category]` sebelumnya tanpa tes perilaku; `page.test.tsx` baru menutupnya.
  - **Belum dikerjakan, milik koordinator:** entri Demo Campaign di `CONTEXT.md` (flag kini tiga arti), blok `SHOW_DEMO_CAMPAIGNS` di `.env.example` (contoh sebaiknya `auto`), dan langkah A6 di `plan.md`.
  - **Verifikasi:** `npx vitest run src/lib/subject-guard.listing.test.ts src/app/page.test.tsx src/app/api/campaigns/route.listing.test.ts src/app/api/zakat/campaigns src/app/api/prayers/route.test.ts src/components/collecting-entity src/app/api/impact src/__tests__/properties/public-listings-effective-status.test.ts src/app/explore` hijau; `npx vitest related --run` atas berkas sumber yang disentuh: 136 berkas lulus, 12 dilewati (bawaan), 0 gagal; `node ci/ratchet.mjs`: tsc 19 dan lint 193, di baseline. Kueri pengecekan dicoba di Postgres lokal sekali pakai: `EXPLAIN SELECT "id" FROM "Campaign" WHERE ("isDemo" = false AND "lifecycleStatus" = 'ACTIVE' AND ("deadline" IS NULL OR "deadline" >= now())) LIMIT 1` memakai indeks itu; basis data dibuang sesudahnya.
