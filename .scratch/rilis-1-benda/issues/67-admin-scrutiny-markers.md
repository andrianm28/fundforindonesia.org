# 67: A-3 admin-scrutiny-markers

**Status:** awaiting-merge

**Blocked by:** none (`CampaignAuditMarker` dan `DonationReviewMarker` sudah ada)

**Ukuran:** S

**Catatan:** Layar baca-saja; tanpa skema.

## Latar

Penanda audit hasil `evaluateSettledDonationScrutiny` ditulis tetapi tidak ada daftar yang bisa dibaca Admin; `/api/admin/scrutiny` belum punya layar.

## Berkas relevan

- `src/lib/scrutiny.ts`
- `src/app/api/admin/scrutiny/route.ts`
- `prisma/schema.prisma` (`CampaignAuditMarker` ~1648, `DonationReviewMarker` ~1668)
- `src/components/admin/AdminSidebar.tsx` (satu baris)
- halaman baru `src/app/admin/scrutiny/page.tsx`

## Acceptance

- [x] Halaman Admin mendaftar penanda Campaign dan Donasi, terbaru lebih dulu, dengan alasan dan tautan ke subjek (tautan Penanda Donasi menuju Campaign-nya; lihat Comments)
- [x] Tanpa data pribadi donor di daftar (nama anonim tetap tersamar)
- [x] Hanya ADMIN yang bisa membuka; yang lain 404 (di tingkat halaman, diuji; proxy dan layout `/admin` lebih dulu mengalihkan, lihat Comments)
- [x] Tes halaman dan tautan sidebar

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
- 2026-10-10, branch `claude/rilis-1-67-admin-scrutiny-markers`: dibangun test-first. Seam: `AdminScrutinyPage` (sesi + baris Prisma) dan `AdminSidebar`; ditambah tes di Postgres sungguhan, `src/__tests__/integration/admin-scrutiny-page-real-db.test.ts` (dilewati dan dicatat bila `TEST_DATABASE_URL` kosong; jalan di CI).
  - Halaman `/admin/scrutiny` (server component, `force-dynamic`), baca-saja, membaca Prisma langsung; route `GET /api/admin/scrutiny` tidak diubah. Dua daftar, terbaru dulu, paling banyak 100: Penanda Audit (Campaign, alasan "Akumulasi Gross X melewati ambang audit Y", waktu dipasang) dan Penanda Donasi (Campaign, id Donation, alasan, waktu ditandai).
  - Akses: halaman memeriksa assignment ADMIN sendiri dan memanggil `notFound()` untuk yang lain, sebelum membaca apa pun (tamu, Verifier, dan pemegang Role ADMIN tanpa assignment diuji). Berkasnya didaftarkan di `ASSIGNMENT_GUARDED_ROUTES` pada `roles-expand-guard.test.ts`. Proxy `/admin` dan layout `/admin` tetap lebih dulu mengalihkan non-ADMIN ke `/` (perilaku semua halaman Admin, tidak diubah di sini), jadi 404 sungguhan di tingkat HTTP hanya tercapai bila itu diubah.
  - Tanpa data Donor: kedua `select` tidak menyebut kolom Donor apa pun, sehingga nama Donation anonim tetap tersamar karena halaman tidak pernah memegangnya. Subjek Donation: tidak ada layar Donation untuk Admin, dan tautan Receipt tidak dipakai (token-nya kapabilitas dan halamannya menyebut Donor), jadi kedua daftar menautkan ke Campaign dan Penanda Donasi menampilkan id Donation sebagai rujukan.
  - Data uji beta (tiket 92): Penanda Donasi hanya untuk Donation yang diselesaikan Payment yang dihitung (`countedPaymentWhere()` ditambah status `PAID`/`REFUNDED`, di dalam query sehingga batas 100 berlaku untuk yang tampil). Penanda Audit menampilkan Gross lewat `withCountedCollectedAmount`, bukan `cumulativeGross` milik penanda (tidak bisa dipilah menurut mode setelah kejadian), dan penanda yang Gross terhitungnya tidak lagi di atas ambang saat dipasang disembunyikan karena hanya uang uji yang memicunya; pemotongan itu dilakukan setelah batas 100. Aturan ini tertulis di teks halaman. `scrutiny.ts` (penulis penanda, membaca `collectedAmount` mentah) tidak diubah; memilahnya menurut mode adalah cakupan tiket 94, dan penyaringan di layar ini tetap berlaku untuk penanda yang sudah tertulis.
  - Sidebar: satu tautan "Penanda Audit & Donasi" dengan ikon yang sudah ada, plus href-nya di `ADMIN_HREFS` agar status aktif jalan.
  - Verifikasi: `npx vitest run src/app/admin src/components/admin src/app/api/admin/scrutiny src/__tests__/properties src/lib/scrutiny.test.ts src/lib/money/counted-payment.test.ts` (57 berkas, 403 tes hijau); `TEST_DATABASE_URL=postgresql://ci:ci@localhost:5432/ci?schema=public npx vitest run src/__tests__/integration/admin-scrutiny-page-real-db.test.ts` (7 tes); `node ci/ratchet.mjs` (tsc 19, lint 193, di baseline). Full suite dan `next build` dijalankan CI.
  - Untuk owner: (1) Admin tidak melihat nama Donor sama sekali, termasuk Donor yang tidak anonim; bila perlu nama tersamar, itu tiket terpisah beserta aturan siapa yang boleh melihat. (2) Penanda yang hanya dipicu uang uji disembunyikan, bukan ditampilkan berlabel; selama beta, gladi ambang Donation besar tidak akan muncul di layar ini (API mentahnya tetap memuatnya). (3) 404 HTTP sungguhan bagi non-ADMIN menuntut perubahan proxy/layout `/admin` untuk semua halaman Admin.
