# Analisa kepatuhan kode terhadap PRD dan ADR 0001–0014

Dibuat 25 September 2026 atas commit `450ede5`, **diperbarui ke commit `87cce13`** (branch `main`) pada hari yang sama. Semua status, hitungan, nomor baris, dan hasil tes di bawah berlaku untuk `87cce13` kecuali disebut lain. Sumber kebutuhan: `docs/PRD-fund-for-indonesia.md` (revisi 22 September 2026), `docs/adr/0001`–`0014`, `CONTEXT.md`, `docs/integrasi-sumopod.md`, dan "Dokumen Konsep Platform: Fund for Indonesia" dari YIEM (berkas unggahan `086e73c6-fund_for_indonesia_platform_concept.md`, 89 baris, tanpa tanggal; selanjutnya "Dokumen Konsep"). Sumber implementasi: `prisma/`, `src/`, `tests/`, konfigurasi build/deploy. Tiket di `.scratch/**` dan plan di `docs/superpowers/plans/` hanya dipakai sebagai petunjuk, bukan bukti.

Legenda status: ✅ Terimplementasi · 🟡 Sebagian · ❌ Tidak ada · ⚠️ Bertentangan (kode melakukan sesuatu yang dilarang PRD/ADR) · ❓ Tidak bisa ditentukan.

---

## 1. Ringkasan eksekutif

Kode ini adalah platform galang dana (turunan klon Kitabisa, `package.json:2` masih bernama `kitabisa-clone`) dengan **lapisan uang yang dibangun serius**: buku besar berpasangan append-only, Escrow Hold, Payout dua orang, Refund sebesar Gross dengan Provider Fee ditanggung platform, adapter Sumopod bertanda tangan svix, idempotensi webhook, dan penguncian baris. Bagian itu rapi dan diuji. Di luar lapisan uang, **hampir seluruh model domain PRD belum ada**: tidak ada Kind, Kind Authorisation, Verification Request, Collecting Entity, Platform Fee, Usage Report, Manual Contribution, Program/CSR, Wakaf, Hibah, email, enkripsi kolom, Impact & Transparency, maupun i18n. Sementara itu Volunteer Trip (Fase 3) sudah dibangun di sisi API sebelum Fase 0–2 selesai.

Terhadap Dokumen Konsep YIEM hasilnya serupa: alur Donasi dan Galang Dana ada sampai tahap pembayaran/publikasi, tetapi alur CSR dan Wakaf tidak ada sama sekali, alur Volunteer hanya ada sebagai API, dan setiap alur berhenti sebelum langkah transparansinya (Receipt, Laporan Transparansi, Impact Report). Beberapa isi Dokumen Konsep sudah diganti keputusan PRD yang lebih baru (Volunteer keluar dari menu utama, Hibah masuk, Inggris ditunda); rinciannya di §5.

Yang paling berbahaya bukan yang belum ada, tetapi yang **bertentangan**: webhook menutup Campaign saat target tercapai (dan bisa menimpa status Suspended); Suspension tidak menahan Payout; dan jalur Trip Fee menerima uang tanpa sakelar donasi maupun pengaman sandbox-di-produksi. Dua celah kritis di baseline pertama (C1: pemilik bisa menulis kolom apa saja lewat PATCH; C2: swa-verifikasi identitas) sudah ditutup di kode oleh commit `b44f803` dan `87cce13`; C1 tuntas, C2 tersisa sebagian (lihat §1a).

**Hitungan status — Matriks PRD (131 butir yang bisa dicek, di `87cce13`):**

| Status | Jumlah |
| --- | --- |
| ✅ Terimplementasi | 32 |
| 🟡 Sebagian | 17 |
| ⚠️ Bertentangan | 10 |
| ❌ Tidak ada | 70 |
| ❓ Tidak bisa ditentukan | 2 |

**Hitungan status — Dokumen Konsep (52 butir, dihitung terpisah dari PRD):**

| Status | Jumlah |
| --- | --- |
| ✅ Terimplementasi | 8 |
| 🟡 Sebagian | 17 |
| ⚠️ Bertentangan | 0 |
| ❌ Tidak ada | 27 |
| ❓ Tidak bisa ditentukan | 0 |

Empat butir ❌ Dokumen Konsep (K9 Volunteer di menu utama, K11–K12 menu Inggris, K52 versi Inggris) sudah digantikan keputusan PRD yang lebih baru (Volunteer pindah ke menu pendukung, Inggris ke Fase 3). Butir itu tetap dihitung ❌ terhadap Dokumen Konsep, tetapi bukan cacat terhadap jadwal PRD. Lihat §5 Konflik antar sumber. Sebagian besar celah Dokumen Konsep lainnya tumpang tindih dengan celah PRD (CSR, Wakaf, Receipt, laporan transparansi); hanya dua yang berdiri sendiri, yaitu Volunteer tidak bisa dicapai dari navigasi mana pun (C18) dan janji kepercayaan di homepage yang tidak bisa ditepati (C19).

**Hitungan status — ADR 0001–0014:** ✅ 2 (0001, 0008) · 🟡 6 (0002, 0005, 0006, 0007, 0011, 0014) · ⚠️ 2 (0004, 0010) · ❌ 3 (0009, 0012, 0013) · N/A 1 (0003, superseded).

**Gerbang fase (PRD §11):** Fase 0 🟡, Fase 1 ❌, Fase 2 ❌, Fase 3 ❌. Tidak ada satu fase pun yang syarat lolosnya terpenuhi.

**Tes dan typecheck (di `87cce13`):** `vitest run` 142 file / 1468 tes lulus pada dua kali jalan. Jalan pertama keluar dengan kode 1 karena 2 *unhandled error* React yang berasal dari `src/components/home/QuickActionTiles.test.tsx` (file yang tidak diubah sejak baseline); file itu lulus tiga kali saat dijalankan sendiri dan jalan penuh kedua bersih (exit 0), jadi ini tes *flaky*, bukan regresi. `tsc --noEmit` gagal dengan 86 error (85 di file tes, 1 di tipe route Next untuk `src/app/api/upload/route.ts`). Build tidak tertahan karena `next.config.mjs` memasang `typescript.ignoreBuildErrors: true` dan `eslint.ignoreDuringBuilds: true`. Dua tes masih **mengunci perilaku yang melanggar ADR 0004** (lihat C3).

### 1a. Perubahan sejak `450ede5`

Tiga commit masuk: `63d954f` (dokumen dan konfigurasi agen saja), `b44f803` (C1), `87cce13` (C2). `git diff --stat 450ede5 HEAD -- src prisma`: 26 file, +398/−1197; `prisma/` tidak berubah (tidak ada migrasi).

**Status dua celah yang ditargetkan (diverifikasi dari kode, bukan dari pesan commit):**

| Celah | Status | Bukti di `87cce13` | Tes yang kini mencakup | Sisa |
| --- | --- | --- | --- | --- |
| C1 Mass assignment PATCH | **Tertutup (Fixed)** | `PATCH` mem-parse body dengan `editCampaignSchema` (hanya `title`, `description`, `story`, `coverImage`, semua opsional) dan menulis `result.data` saja `src/app/api/campaigns/[slug]/route.ts:14-19, 147-159`. Zod `object` membuang kunci lain, jadi `status`, `lifecycleStatus`, `collectedAmount`, `targetAmount`, `deadline`, `category`, `isUrgent`, `isDemo`, `creatorId` tidak bisa ditulis, termasuk oleh ADMIN. Tidak ada penulis `campaign.update` lain selain moderasi dan webhook | `src/app/api/campaigns/[slug]/route.test.ts:352` (status dari ADMIN diabaikan), `:396` (uang, status, kepemilikan dibuang), `:423` (tenggat, kategori, isUrgent dibuang), `:447` (400 tanpa tulis); guard `src/__tests__/properties/campaign-status-dual-write.test.ts` kini memasukkan PATCH ke daftar penulis tanpa status | Efek samping: lihat C20 (hilangnya jalan Admin/Fundraiser ke COMPLETED dan jalan Admin menyuspensi) dan catatan kecil bahwa cerita/sampul bisa diubah setelah lolos moderasi tanpa ditinjau ulang (Rendah; PRD hanya mewajibkan tinjauan ulang untuk target, tenggat, rekening). C11 (DELETE) tidak disentuh |
| C2 Swa-verifikasi identitas | **Sebagian (Partial)** | `POST /api/user/verify` kini selalu 401/503 dan tidak menulis apa pun `src/app/api/user/verify/route.ts:9-19`; `VerificationDialog.tsx` (458 baris) dan `VerificationBadge.tsx` (69 baris) dihapus; lencana hilang dari kartu, detail Campaign, dan `/akun`; panel Admin menandai `isVerified` lama sebagai "Klaim sendiri" `src/app/admin/users/page.tsx:333-340`; gerbang `/campaign/create` kini memakai role, sama dengan API `src/app/campaign/create/page.tsx:78-110`; middleware mengalihkan Donor ke `/akun` (dulu `/akun/verifikasi`, rute yang tidak ada) `src/middleware.ts:31-35` | `src/app/api/user/verify/route.test.ts`, `src/app/akun/page.test.tsx`, `src/app/campaign/create/page.test.tsx`, `src/app/admin/users/page.test.tsx`, `src/middleware.test.ts`, `CampaignCard/CampaignDetail/CampaignDetailView.test.tsx` | (a) Role `CAMPAIGN_CREATOR` dan `isVerified` yang sudah diperoleh lewat swa-verifikasi sebelum `87cce13` **tetap berlaku**: tidak ada migrasi atau skrip pencabutan (isi DB tidak bisa saya periksa). (b) Pemeriksa identitas kini Admin, bukan Verifier (PRD FFI-05, ADR 0005), di luar platform, tanpa dokumen tersimpan dan tanpa audit perubahan Role (`src/app/api/admin/users/[id]/role/route.ts:34` hanya `user.update`). (c) Salinan basi yang menjanjikan swa-verifikasi: `src/app/(static)/help/page.tsx:48-56` ("selesai secara instan"), `faq-accordion.tsx:14`, `terms/page.tsx:56`, `src/app/akun/kampanye-saya/page.tsx:125-131` ("Verifikasi Sekarang"). (d) `creator.isVerified` masih dikirim di payload publik (`src/app/api/campaigns/[slug]/route.ts:36`, `src/app/api/campaigns/route.ts:70`) walau tidak lagi ditampilkan |

**Apa yang dihapus oleh −1197 baris, dan apakah ada kebutuhan yang kehilangan implementasinya:**

| Yang dihapus | Baris | Kebutuhan terkait | Kehilangan implementasi yang patuh? |
| --- | --- | --- | --- |
| `src/components/dialogs/VerificationDialog.tsx` + tesnya | 458 + 248 | PRD FFI-05 (identitas oleh Verifier) | Tidak. Formulir itu adalah mekanisme swa-verifikasi yang melanggar FFI-05; tidak ada yang patuh yang hilang. Yang hilang adalah satu-satunya **jalur di aplikasi** untuk menjadi Fundraiser; kini sepenuhnya di luar platform |
| `src/components/shared/VerificationBadge.tsx` + tesnya | 69 + 75 | Dokumen Konsep K50 ("Verified programs"); PRD §1 elemen kepercayaan | Tidak. Lencana itu klaim palsu. Kini tidak ada klaim sama sekali (K50 ⚠️ → ❌) |
| Blok "Property 5: Verification Role Upgrade" di `src/__tests__/properties/api-validation.property.test.ts` | 138 | — | Tes perilaku yang sengaja dihapus; digantikan `src/app/api/user/verify/route.test.ts` yang memastikan tidak ada yang diberikan |
| Logika `...rest` + pemetaan `status → lifecycleStatus` di PATCH | ~12 | PRD §8 ("Completed ditetapkan Fundraiser atau Admin"), FFI-07b (Suspension diputuskan Admin), ADR 0004 | **Ya, secara fungsional.** Jalur lama tidak patuh (tanpa syarat Campaign Update, tanpa predikat), tetapi itu satu-satunya jalan API bagi Fundraiser/Admin untuk menandai COMPLETED dan bagi Admin (tanpa penugasan VERIFIER) untuk menyuspensi atau mencabut Suspension. Kini COMPLETED hanya terjadi lewat auto-complete webhook yang melanggar ADR 0004, dan Suspension hanya lewat moderasi Verifier. Tidak ada UI yang memakai jalur lama, jadi tidak ada layar yang rusak. Dicatat sebagai C20 |
| Blok verifikasi di `src/app/akun/page.tsx` | ~50 | — | Tidak; diganti ajakan "Hubungi Admin" |

**Pergeseran status karena tiga commit ini:**

- Matriks PRD: #38 ⚠️ → ❌ (tidak lagi swa-verifikasi, tetapi pemeriksaan Verifier belum ada); #42 ⚠️ → ❌ (PATCH tidak lagi mengubah target/tenggat, tetapi Verification Request belum ada). Catatan diperbarui pada #29, #117, #119. Hitungan: ⚠️ 12 → 10, ❌ 68 → 70.
- Matriks Dokumen Konsep: K20 ⚠️ → 🟡, K21 🟡 → ✅, K50 ⚠️ → ❌. Hitungan: ✅ 7 → 8, ⚠️ 2 → 0, ❌ 26 → 27. Catatan diperbarui pada K2, K4, K5, K6 dan tabel §3.2a.
- ADR: tidak ada status yang berubah. Catatan diperbarui pada 0004 (PATCH tidak lagi mengubah status; kini webhook satu-satunya jalan ke COMPLETED), 0005 (jalan menjadi Fundraiser kini bergantung pada pengeditan Role oleh Admin), 0010 (Fundraiser perorangan kini didaftarkan Admin, masih tanpa sponsor).
- Gerbang fase: tidak berubah (Fase 0 🟡; Fase 1–3 ❌). Fundraiser baru kini bisa didaftarkan tanpa intervensi DB lewat `/admin/users`, tetapi Verification Request tetap tidak ada.
- Tes: 139 → 142 file, 1482 → 1468 tes (5 file tes baru, 2 dihapus). `tsc` 87 → 86 error.
- Dokumen: `CLAUDE.md` tidak lagi memerintahkan `/specflow:*` (`63d954f`); temuan "CLAUDE.md basi" di §7.3 ditutup, dengan satu catatan baru (lihat §7.3).
- Tiket: tidak ada baris `Status:` yang berubah. Satu koreksi atas laporan sebelumnya: tiket 02, 04, 05 **memang punya** baris `Status: ready-for-agent`; klaim "tanpa baris Status" di versi `450ede5` salah (grep saya menangkap baris "What to build" yang memuat kata "Statuses"). C1 dan C2 diperbaiki tanpa tiket di `.scratch/`.

### 1b. Perubahan sejak `87cce13`: C20 (catatan singkat, 25 September 2026)

Matriks di §2–§4 **belum dihitung ulang**. Bagian ini hanya mencatat apa yang berubah sejak `87cce13`, sampai `00ff4f5` di `main`, ditambah perbaikan yang sedang berjalan. Rinciannya ada di `.scratch/campaign-status-transitions/` (spec plus tiket 01–11).

- **C20 tertutup.**
  - **Jalan sah ke COMPLETED sekarang ada.** Fundraiser, atau Admin dengan alasan, bisa menandai Campaign Completed. Syaratnya minimal satu Campaign Update, dan hanya dari status efektif Active.
  - **Suspension sesuai FFI-07b.** Suspension dijatuhkan Admin dengan alasan, dari Active, Expired, atau Completed (ADR 0015). Yang mencabut harus Admin lain, dan Campaign kembali ke status asalnya.
  - **Verifier tidak lagi men-suspend.** Verifier memasang Flag.
  - **Cancellation punya alur.** Fundraiser mengajukan, lalu Admin memutuskan.
  - **Urgent punya penulis**, yaitu Admin.
  - **Semua perubahan status tercatat** di log `CampaignStatusChange` beserta pelaku dan capacity-nya (PRD §9).
  - **Tidak pernah atas Campaign sendiri.** Admin maupun Verifier tidak pernah bertindak atas Campaign miliknya sendiri.
- **Celah teratas #1 tertutup.** Webhook Settlement tidak lagi menulis status. Tes yang dulu mengunci perilaku yang melanggar ADR 0004 sudah diganti (C3).
- **Migrasi baru**: `CampaignStatusChange`, `CancellationRequest`, dan `CampaignFlag`. Ketiganya sudah diverifikasi berjalan bersih di Postgres 16 dari nol. `migrate diff` terhadap `schema.prisma` kosong, dan penolakan foreign key saat DELETE menghasilkan P2003 dengan nama constraint yang diandalkan jawaban 409.
- **Celah teratas #2 tertutup** (`.scratch/subject-guard-and-suspension-money/`, 5/5 tiket `done`):
  - Payout hanya bisa diajukan dan disetujui saat Campaign Active, Expired, atau Completed. Suspended dan Cancelled menolaknya (409 `PAYOUT_NOT_ALLOWED_FOR_STATUS`), termasuk kalau Suspension jatuh di antara pengajuan dan persetujuan.
  - Sweep escrow menahan dana Campaign Suspended dan melepasnya setelah Suspension dicabut. Refund tetap bisa dilakukan.
  - Modul penjaga (`src/lib/subject-guard.ts`) jadi satu-satunya pemilik kunci baris Campaign dan Trip.
  - Error uang punya `code` dan satu pemetaan HTTP.
  - Laporan rekonsiliasi memberi label Suspension pada dana yang tertahan.
  - Halaman Campaign menampilkan banner untuk Suspended, Cancelled, dan Campaign yang sudah berakhir; alasan Suspension hanya untuk Fundraiser pemilik.
  - Tiket 30 ditutup karena diserap spec ini.
- **Dua bug baru ditemukan dan sudah diperbaiki di `main`** (`.scratch/campaign-rule-bugs/`, keduanya `done`):
  - (1) `POST /api/donations` menerima Donation untuk Campaign Active yang tenggatnya sudah lewat.
  - (2) Admin yang juga Fundraiser bisa membuat atau menyetujui Refund atas Campaign sendiri.
- **Refactor arsitektur sudah masuk `main`** (`.scratch/lifecycle-runner-and-adapter/`): satu runner internal untuk semua command (selalu kunci, lalu baca; `now` di setiap timestamp), satu adaptor HTTP untuk semua route siklus hidup, dan `src/lib/api-errors.ts` yang mati dihapus. Aturan Admin di CONTEXT.md kini juga mencakup Volunteer Trip. Di `0f10c2d`: 155 file dan 1858 tes lulus, `tsc` 85 error.
- **Daftar publik** (`.scratch/effective-status-listings/`):
  - Kebocoran `GET /api/campaigns?status=` sudah ditutup. Sebelumnya parameter ini membuka Campaign Submitted, Rejected, dan Suspended ke publik.
  - Pemindahan semua daftar publik ke status efektif sedang berjalan (tiket 02).
- **Tes flaky** property test password sudah diperbaiki (`.scratch/flaky-tests/`). Cost bcrypt sekarang ada di satu modul, dan itu separuh pekerjaan tiket 40.
- **Susulan 26 September** (review arsitektur kedua):
  - **Moderasi Volunteer Trip** hanya menerima Trip SUBMITTED (409 `TRIP_NOT_SUBMITTED`) dan tahan balapan. Sebelumnya Trip Rejected atau Active bisa di-"approve" (`campaign-rule-bugs/03`).
  - **Campaign tidak pernah dihapus** (ADR 0016). Endpoint DELETE dan tombolnya dihapus, jadi C11 tertutup.
  - **Verifier tidak memoderasi Trip miliknya sendiri.**
  - **Istilah Capacity** masuk CONTEXT.md. Penilai Capacity (`src/lib/capacity.ts`) jadi satu-satunya tempat aturan "tidak bertindak atas milik sendiri". Persetujuan Payout kini ikut menolak Admin pemilik, dan route "hanya pemilik" menjawab seragam dengan 403 `NOT_AUTHORIZED`.
  - **Akses Admin dan Verifier sekarang hanya lewat penugasan** (`capacity-judgement/03`, `campaign-rule-bugs/04`).
  - **Setiap pengguna terdaftar boleh mengajukan Campaign atau Trip** (PRD FFI-04; `retire-role-hierarchy/01`). CAMPAIGN_CREATOR tidak lagi menjadi gerbang. Penghapusan Role, `isVerified`, dan editor role sedang dikerjakan (`retire-role-hierarchy/02`). Tiket 06–08 `prd-compliance` ditutup karena sudah diserap.
  - **String status lama pensiun** (`legacy-status-contract/01–02`). Tidak ada lagi yang membaca atau menulisnya, dan DRAFT sekarang bisa ditulis. Penghapusan kolomnya ada di tiket 03, `ready-for-human`.
  - **Modul operasi Volunteer Trip** (`volunteer-trip-operations/01`). Pengajuan dan moderasi Trip berjalan di bawah kunci, dengan log status. Operasi Batch dan Registration sedang dikerjakan.
  - **`deploy.sh` tidak lagi menjalankan seed di setiap deploy** (`deploy-fixes/01`). Celah teratas #7 separuh tertutup; akun demo di produksi masih perlu dicek.
- **Terbuka untuk manusia:** backfill Suspension yang dijatuhkan sebelum log ada (tiket 11 `campaign-status-transitions`).
- **Tes dan typecheck di `00ff4f5`:** `vitest run` 153 file dan 1989 tes lulus. Sesekali ada timeout property test di bawah beban mesin tinggi; tes itu lulus saat dijalankan sendiri. `tsc --noEmit` 85 error.

### Sepuluh celah teratas di `87cce13` (uang/hukum/keamanan lebih dulu)

| # | Celah | Tingkat | Bukti utama | Posisi di `450ede5` |
| --- | --- | --- | --- | --- |
| 1 | Webhook Settlement menandai Campaign `completed` begitu target tercapai, tanpa melihat status saat itu. Melanggar ADR 0004 dan PRD §8, menghentikan donasi, dan bisa mengubah Campaign SUSPENDED/CANCELLED menjadi COMPLETED. Dikunci oleh tes. Kini juga satu-satunya jalan ke COMPLETED (C20) | Kritis | `src/app/api/webhooks/[provider]/route.ts:342-360`; tes `src/app/api/webhooks/[provider]/route.test.ts:396-405`, `src/__tests__/integration/donation-flow.test.ts:290-293` | #3 |
| 2 | Suspension tidak membekukan apa pun di lapisan uang: `requestPayout`/`approvePayout`/`releaseMaturedEscrow` tidak memeriksa status Campaign; Verifier (bukan Admin) yang menyuspensi, dan Verifier yang sama bisa "approve" lagi tanpa predikat status | Kritis | `src/lib/money/payouts.ts:110-175, 209-320`; `src/app/api/moderasi/campaigns/[id]/route.ts:7-14, 52-55` | #4 |
| 3 | Jalur uang Trip Fee melewati sakelar `NEXT_PUBLIC_DONATIONS_ENABLED` dan pengaman `sandboxInProductionReason`, padahal `docs/integrasi-sumopod.md` menyebut pengaman itu wajib karena kasusnya tak terpulihkan | Tinggi | `src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts:78-97` vs `src/app/api/donations/route.ts:48-63` | #5 |
| 4 | Janji uang kepada Donor tidak dibekukan: tidak ada Platform Fee sama sekali (tidak ada kolom, leg buku besar, pengaturan Admin, maupun pembebasan <Rp50.000; refund memaku `platformFeePortion = 0`), dan Escrow Hold dihitung dari waktu server saat webhook, bukan `settled_at` penyedia, dengan lama hold berupa konstanta yang tidak disalin ke Payment | Tinggi | `src/lib/money/ledger.ts:367-390`; `src/lib/money/refunds.ts:219, 289-293`; `src/app/api/webhooks/[provider]/route.ts:243-244`; `src/lib/money/escrow.ts:14` | #6 |
| 5 | Tidak ada Kind, Kind Authorisation, maupun Collecting Entity (ADR 0002/0009/0010/0013). Halaman zakat menjual Campaign kategori `kemanusiaan` sebagai tujuan zakat, tombol "Bayar Zakat" membuang nominal serta kategorinya, dan banner homepage mempromosikan zakat sebagai "terpercaya" | Tinggi (hukum/syariah) | `src/app/api/zakat/campaigns/route.ts:12-18`; `src/app/zakat/page.tsx:90-95`; `src/app/page.tsx:37-41`; `src/app/explore/all/page.tsx` tidak membaca `searchParams` | #7 |
| 6 | Jalur Payout tidak bisa diselesaikan tanpa intervensi DB: tidak ada route yang membuat atau memverifikasi `BankAccount`, tidak ada transisi ke COMPLETED dengan bukti, `PAYOUT_CLEARING` tak pernah dikosongkan | Tinggi | `grep bankAccount.create` kosong di `src/`; `src/lib/money/payouts.ts:199-207` | #8 |
| 7 | Deploy dan kredensial: `deploy.sh` menjalankan seed di setiap deploy dengan `set -e`, seed menolak DB berisi sehingga deploy kedua berhenti sebelum app dijalankan; pada lingkungan baru seed membuat `admin@kitabisa.com` / `password123` dengan penugasan ADMIN dan VERIFIER | Tinggi | `deploy.sh:2, 20-26`; `prisma/seed.ts:78, 207-223, 245, 554` | #9 |
| 8 | Sisa C2: jalan menjadi Fundraiser kini sepenuhnya manual dan tak tercatat. Admin (bukan Verifier) memeriksa identitas di luar platform lalu mengubah Role lewat `/admin/users`; tidak ada dokumen, tidak ada audit perubahan Role. Role `CAMPAIGN_CREATOR` dan `isVerified` yang dulu diperoleh lewat swa-verifikasi **tidak dicabut** (tanpa migrasi). Halaman bantuan masih menjanjikan verifikasi "selesai secara instan" | Tinggi | `src/app/api/user/verify/route.ts:9-19`; `src/app/api/admin/users/[id]/role/route.ts:34`; tidak ada migrasi di `prisma/` sejak baseline; `src/app/(static)/help/page.tsx:48-56` | baru (C2 dulu #2) |
| 9 | Pemilik Campaign atau pengguna ber-role ADMIN bisa menghapus Campaign (Donation pending ikut terhapus), melewati alur Cancelled; tombol hapus di panel Admin selalu 404 | Tinggi | `src/app/api/campaigns/[slug]/route.ts:183-230`; `src/app/admin/campaigns/DeleteCampaignButton.tsx:22` | di luar 10 besar |
| 10 | Ujung setiap alur transparansi hilang: Dokumen Konsep menutup alur Donasi dengan "Receipt & Impact Update" dan alur Galang Dana dengan "Laporan Transparansi", serta menjanjikan "Transparent reporting • Measurable impact" di homepage; PRD menuntut Receipt email, Usage Report, dan halaman Impact & Transparency. Tidak satu pun ada, dan tab "Pencairan Dana" selalu kosong | Tinggi (kepercayaan/kepatuhan) | Dokumen Konsep baris 43, 48, 89; PRD FFI-01, FFI-07a, FFI-14; `src/components/campaign/CampaignDetail.tsx` tab Pencairan Dana | #10 |

**Keluar dari sepuluh besar:** C1 (mass assignment PATCH) tertutup penuh; C2 turun dari Kritis ke Tinggi dan kini tercatat sebagai sisa di #8.

**Di luar sepuluh besar tetapi layak disebut:** seluruh modul CSR (Dokumen Konsep alur 3 dan format halaman Program; PRD FFI-09/10) dan Wakaf (alur 4; FFI-08) belum ada sama sekali; Volunteer tidak bisa dicapai dari navigasi mana pun (C18); setelah C1 ditutup, tidak ada jalan sah bagi Fundraiser maupun Admin untuk menandai Campaign COMPLETED atau bagi Admin untuk menyuspensi (C20).

---

## 2. Matriks PRD

Kolom "Tes" menyebut file tes yang mencakup perilaku itu; "—" berarti tidak ada tes yang relevan.

### 2.1 Ringkasan, menu, dan cakupan (§1, §3, §6)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 1 | Headline "Connecting Generosity with Real Impact in Indonesia", CTA Donate Now + 4 CTA sekunder, elemen kepercayaan (§1) | 🟡 | `src/lib/home/quickActionTiles.ts:29-35` | `src/components/home/QuickActionTiles.test.tsx`, `src/lib/home/quickActionTiles.test.ts` | Tile ada; CSR/Wakaf/Hibah `comingSoon`. Headline tidak ada di `src/` (grep kosong) |
| 2 | Lima menu utama Donasi, Galang Dana, Kolaborasi CSR, Wakaf, Hibah (§3) | 🟡 | `src/components/layout/DesktopHeader.tsx:67-89` | `src/components/layout/DesktopHeader.test.tsx` | Header memuat Donasi, Galang Dana, Zakat (plus ikon notifikasi); CSR/Wakaf/Hibah tidak ada |
| 3 | Zakat bukan menu tersendiri, halaman di bawah Donasi (§3) | ⚠️ | `src/components/layout/DesktopHeader.tsx:79` | — | Zakat adalah item header tingkat atas |
| 4 | Menu pendukung: Tentang Kami, Impact & Transparency, Stories, Mitra, Volunteer, FAQ, Hubungi Kami, Masuk/Dashboard (§3) | 🟡 | `src/components/layout/Footer.tsx:19-36` | `src/__tests__/properties/static-pages-accessibility.property.test.ts` | Impact, Stories, Mitra, Volunteer tidak ada |
| 5 | Slug `/wakaf` dan `/hibah` (§3) | ❌ | `src/app/` tidak memuat keduanya | — | |
| 6 | Dompet dihapus (§6) | 🟡 | Migrasi `prisma/migrations/20260920133450_drop_topup_model`; `src/lib/wallet.ts:1-23`; `src/app/api/balance/route.ts` | `src/__tests__/properties/collected-amount-single-writer.test.ts`, `src/app/api/balance/route.test.ts` | Top-up/spend hilang; `User.donationBalance` (`prisma/schema.prisma:39`) dan "Saldo Kantong Donasi" (`src/app/akun/page.tsx:110`) masih ada, sengaja karena saldo Rp1.371.884 milik 5 user belum diselesaikan |
| 7 | AutoDonation diparkir (§6) | ✅ | Model tetap (`prisma/schema.prisma:290-305`), tidak ada route yang memakainya | — | |
| 8 | Demo Campaign ditolak menerima uang (§12) | ✅ | `src/app/api/donations/route.ts:100-105`; `src/lib/money/payouts.ts:129-137`; `src/lib/money/refunds.ts:193-198` | `src/app/api/donations/route.test.ts`, `src/lib/money/payouts.test.ts` | |
| 9 | Demo Campaign disembunyikan dari katalog dan Impact saat Campaign nyata pertama Active (§11 Fase 1) | ❌ | Katalog hanya menandai `isDemo` (`src/app/explore/all/page.tsx:32`) | — | Tiket 26 `ready-for-agent` |

### 2.2 FFI-01 Donasi

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 10 | Donasi tanpa akun | ✅ | `src/app/api/donations/route.ts:115-116`; `Donation.donorId` opsional `prisma/schema.prisma:214` | `src/app/api/donations/route.enabled.test.ts` | |
| 11 | Minimum Rp20.000 | ⚠️ | API `min(1000)` `src/app/api/donations/route.ts:37`; UI `MIN_AMOUNT = 20000` `src/app/campaign/[slug]/donate/page.tsx:14` | — | Batas hanya di klien; API menerima Rp1.000 |
| 12 | Platform Fee dibebaskan di bawah Rp50.000 | ❌ | Tidak ada Platform Fee (lihat #126) | — | |
| 13 | Email wajib; nama dan telepon opsional | ❌ | `Donation` tanpa email/nama/telepon `prisma/schema.prisma:206-228`; skema zod `src/app/api/donations/route.ts:35-43` | — | Guest Donor tidak meninggalkan kontak apa pun, sehingga Receipt mustahil |
| 14 | Anonim tersembunyi dari publik dan dari Fundraiser | 🟡 | `src/app/api/campaigns/[slug]/donations/route.ts:60` | — | Publik: ya. Tampilan Fundraiser belum ada |
| 15 | Platform Fee, Provider Fee, lama Escrow Hold disalin ke Payment saat dibuat dan ditampilkan sebelum bayar | ❌ | `Payment` hanya punya `providerFee` yang diisi saat Settlement `src/app/api/webhooks/[provider]/route.ts:255-261`; hold konstanta `src/lib/money/escrow.ts:14` | — | |
| 16 | QRIS via Sumopod saja sebelum launching | ✅ | `src/lib/payments/sumopod-provider.ts:75-153`; `src/app/campaign/[slug]/donate/page.tsx:32` | `src/lib/payments/sumopod-provider.test.ts`, `src/app/campaign/[slug]/donate/page.enabled.test.tsx` | |
| 17 | Payment kedaluwarsa 24 jam; Donation ditutup saat penyedia mengabarkan kedaluwarsa | ✅ | `src/lib/payments/sumopod-provider.ts:149-151`; `src/app/api/webhooks/[provider]/route.ts:462-495` | `src/app/api/webhooks/[provider]/route.test.ts` | |
| 18 | Coba bayar lagi lewat Payment baru pada Donation yang sama | ⚠️ | `Payment.donationId @unique` `prisma/schema.prisma:407`; `providerRef = donation.id` `src/app/api/donations/route.ts:226` | — | Skema melarang lebih dari satu Payment per Donation, bertentangan dengan CONTEXT.md "Payment" |
| 19 | Receipt ke email setelah Settlement | ❌ | Tidak ada mailer (grep nodemailer/resend/smtp kosong); hanya notifikasi in-app `src/lib/notifications.ts:10` | — | |
| 20 | Traffic Source tercatat | ❌ | Tidak ada kolom maupun parameter | — | |

### 2.3 FFI-02 Detail Campaign, FFI-03 Campaign Update

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 21 | Target, Gross terkumpul, tenggat, Campaign Update terakhir | ✅ | `src/app/api/campaigns/[slug]/route.ts:52-71`; `src/components/campaign/CampaignDetail.tsx:87` | `src/components/campaign/CampaignDetail.test.tsx`, `CampaignDetailView.test.tsx` | |
| 22 | Penerima manfaat dan lokasi provinsi/kabupaten | ❌ | Tidak ada kolom di `Campaign` `prisma/schema.prisma:143-202` | — | |
| 23 | Platform Fee, lama Escrow Hold, rincian fee di halaman Campaign | ❌ | Tidak ada di `CampaignDetail.tsx` | — | |
| 24 | Daftar Payout Completed beserta Usage Report | 🟡 | `src/app/api/campaigns/[slug]/disbursements/route.ts:28-38`; tab `CampaignDetail.tsx:80` | — | Daftar ada, tapi tidak ada Payout yang bisa mencapai COMPLETED dan tidak ada Usage Report |
| 25 | Fundraiser menulis Campaign Update dari dashboard | 🟡 | API `src/app/api/campaigns/[slug]/updates/route.ts:70-146` | — | Tanpa UI di dashboard |
| 26 | Update terkirim ke email semua Donor | ❌ | `notifyCampaignUpdate` (`src/lib/notifications.ts:77`) tidak punya pemanggil | `src/lib/notifications.test.ts` (fungsi saja) | Kode mati |
| 27 | Completed butuh minimal satu Campaign Update | ❌ | Webhook menandai completed tanpa syarat (`route.ts:342-360`) | — | |
| 28 | Pengingat email 7 hari sebelum tenggat | ❌ | Tidak ada penjadwal (`src/lib/money/escrow.ts:95-99` mengakuinya) | — | |

### 2.4 FFI-04 Buat Campaign, FFI-05 Verifikasi, FFI-06 Berbagi

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 29 | Setiap pengguna terdaftar bisa membuat dan menyimpan Draft | ⚠️ | `withRoleCheck("CAMPAIGN_CREATOR")` `src/app/api/campaigns/route.ts:107`; langsung `pending`/SUBMITTED `route.ts:146-147`; middleware mengalihkan DONOR ke `/akun` `src/middleware.ts:31-35` | `src/app/api/campaigns/route.test.ts`, `src/middleware.test.ts`, `src/app/campaign/create/page.test.tsx` | Status DRAFT ada di enum tapi tak pernah dipakai; akses dipersyaratkan peran, bukan pendaftaran. Sejak `87cce13` role itu hanya bisa diberikan Admin secara manual (`src/app/campaign/create/page.tsx:78-110`), jadi kesenjangan dengan "setiap pengguna terdaftar" justru melebar, meski kini disengaja |
| 30 | Kind di formulir | ❌ | Tidak ada kolom Kind | — | |
| 31 | Tenggat wajib kecuali `wakaf`; durasi maks 12 bulan | ❌ | `deadline: z.string().datetime().optional()` `src/app/api/campaigns/route.ts:15` | — | |
| 32 | Unggah dokumen per Kind (§7.1) | ❌ | Upload hanya gambar, ke `public/uploads` `src/app/api/upload/route.ts:7-8` | `src/app/api/upload/route.test.ts` | |
| 33 | Submit membuat Verification Request | ❌ | Tidak ada model | — | Tiket 12 |
| 34 | Maks 3 Campaign Active sebelum Usage Report pertama | ❌ | — | — | |
| 35 | Antrean Verifier | ✅ | `src/app/moderasi/campaigns/page.tsx:6`; gate `src/app/moderasi/layout.tsx:14` | `src/app/moderasi/layout.test.tsx`, `src/app/moderasi/page.test.tsx` | Membaca kolom string lama `status: "pending"` |
| 36 | Checklist dokumen per Kind, butir "bukan duplikat" | ❌ | Aksi hanya approve/reject/suspend `src/app/api/moderasi/campaigns/[id]/route.ts:7` | — | |
| 37 | Petunjuk duplikat `pg_trgm` ambang 0,6 | ❌ | grep `pg_trgm`/`similarity(` kosong | — | Tiket 14 |
| 38 | Identitas Fundraiser diverifikasi Verifier | ❌ | Sejak `87cce13` swa-verifikasi ditutup: `POST /api/user/verify` menjawab 503 tanpa menulis apa pun `src/app/api/user/verify/route.ts:9-19`. Penggantinya: Admin memeriksa identitas di luar platform lalu mengubah role di `/admin/users` (`src/app/api/admin/users/[id]/role/route.ts:34`) | `src/app/api/user/verify/route.test.ts` | Tidak lagi bertentangan, tetapi belum ada: pemeriksa adalah Admin, bukan Verifier; tidak ada catatan dokumen maupun audit perubahan role. Lihat C2 |
| 39 | Catatan penolakan dikirim ke Fundraiser lewat email | ❌ | Tidak ada field alasan; notifikasi in-app generik `route.ts:16-20, 58-66` | `src/app/api/moderasi/campaigns/[id]/route.test.ts` | |
| 40 | Submit ulang = Verification Request baru, riwayat tersimpan | ❌ | — | — | |
| 41 | Jejak audit pelaku, waktu, hasil | ❌ | Update langsung tanpa aktor `route.ts:52-55` | — | |
| 42 | Perubahan target/tenggat/rekening pada Campaign Active membuat Verification Request baru | ❌ | Sejak `b44f803` PATCH hanya menerima `title`, `description`, `story`, `coverImage` `src/app/api/campaigns/[slug]/route.ts:14-19, 147-159`; target/tenggat tidak bisa diubah sama sekali | `src/app/api/campaigns/[slug]/route.test.ts:396-446` | |
| 43 | Fundraiser bisa menarik Verification Request | ❌ | — | — | |
| 44 | Tombol bagikan WA/FB/X/salin tautan, pratinjau dari sampul | ✅ | `src/components/shared/ShareModal.tsx:26-85`; `src/lib/seo.ts:24-36` | `src/components/shared/ShareModal.test.tsx`, `src/lib/seo.test.ts` | |
| 45 | Traffic Source per tautan | ❌ | Tautan tanpa parameter sumber | — | |

### 2.5 FFI-07 Payout, 07a Usage Report, 07b Suspension, 07c Manual Contribution

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 46 | Payout hanya dari Campaign Balance buku besar setelah Escrow Hold | ✅ | `src/lib/money/payouts.ts:151-157, 283-289`; `src/lib/money/ledger.ts:233-238` | `src/lib/money/payouts.test.ts`, `src/app/api/campaigns/[slug]/payouts/route.test.ts` | |
| 47 | Escrow Hold dihitung dari perkiraan settlement penyedia | ⚠️ | `paidAt = new Date()`; `escrowReleaseAt(paidAt)` `src/app/api/webhooks/[provider]/route.ts:243-244` | `src/lib/money/escrow.test.ts` | `paid_at`/`settled_at` Sumopod diabaikan; tiket 19 |
| 48 | Admin mencatat saldo nyata dashboard penyedia pada Payout | ❌ | Tidak ada kolom | — | |
| 49 | Bank Account diverifikasi (cek nama penyedia atau Verifier) | ❌ | `BankAccount.verifiedAt` dicek (`payouts.ts:139-142`) tetapi tidak ada route yang membuat atau memverifikasi BankAccount | — | Payout mustahil tanpa menulis DB langsung |
| 50 | Persetujuan oleh Admin yang bukan peminta | ✅ | `payouts.ts:230-232`; `withAssignmentCheck(ADMIN)` `src/app/api/campaigns/[slug]/payouts/[id]/approve/route.ts:24` | `payouts.test.ts`, `.../approve/route.test.ts` | |
| 51 | Admin ketiga (≠ penyetuju) menandai Completed dengan bukti | ❌ | Tidak ada endpoint; `payouts.ts:199-207` mengakuinya | — | Tiket 27 |
| 52 | Status Payout terlihat Fundraiser | ❌ | Route Campaign payouts hanya `POST` `src/app/api/campaigns/[slug]/payouts/route.ts:29`; tidak ada UI | — | Trip punya GET (`src/app/api/volunteer-trips/[slug]/payouts/route.ts:101`) |
| 53 | Usage Report wajib sebelum Payout berikutnya | ❌ | — | — | |
| 54 | Gross >Rp100 juta memicu pemeriksaan ulang Verifier | ❌ | — | — | Tiket 38 |
| 55 | Usage Report: narasi, rincian = nominal Payout, foto, penerima manfaat, publik, penanda "dipertanyakan" | ❌ | Tidak ada model | — | Tiket 29 |
| 56 | Verifier menandai "dilaporkan", Admin memutuskan Suspension | ⚠️ | Verifier langsung menyuspensi `src/app/api/moderasi/campaigns/[id]/route.ts:7-14, 22`; halaman laporan placeholder `src/app/moderasi/reports/page.tsx` | `.../route.assignment-gate.test.ts` | |
| 57 | Suspension menghentikan Donation dan menyembunyikan dari katalog | ✅ | `src/lib/campaign-lifecycle.ts:37-41`; katalog filter `status` `src/app/api/campaigns/route.ts:37-45` | `src/app/api/donations/route.enum-gate.test.ts` | Katalog menerima parameter `status` dari klien, lihat C14 |
| 58 | Suspension membekukan Escrow Hold dan Campaign Balance, menolak Payout | ❌ | Tidak ada cek status di `payouts.ts`, `escrow.ts`, `refunds.ts` | — | Lihat C4 |
| 59 | Alasan tercatat dan tampil; dicabut Admin lain | ❌ | Tidak ada field alasan; Verifier `approve` mengaktifkan kembali tanpa predikat | — | |
| 60 | Manual Contribution | ❌ | Tidak ada model/akun | — | Tiket 34 |

### 2.6 FFI-07d dan §7.2 Refund

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 61 | Refund sebesar Gross; Provider Fee ke akun biaya refund | ✅ | `src/lib/money/ledger.ts:431-497`; `REFUND_COST` `prisma/schema.prisma:391-394` | `src/lib/money/ledger.test.ts`, `src/lib/money/refunds.test.ts` | |
| 62 | Admin membuat Refund; Donor tidak bisa memulai sendiri | ✅ | `withAssignmentCheck(ADMIN)` `src/app/api/campaigns/[slug]/refunds/route.ts:26` | `src/app/api/campaigns/[slug]/refunds/route.test.ts` | |
| 63 | Pemicu massal: Suspension, Cancelled, dana masuk setelah tutup otomatis masuk antrean | ❌ | — | — | |
| 64 | Webhook Settlement selalu diterima apa pun status Campaign | ✅ | Webhook tidak memeriksa status Campaign `route.ts:214-391` | `src/app/api/webhooks/[provider]/route.test.ts` | Efek samping auto-complete, lihat C3 |
| 65 | Pembekuan seketika lewat jurnal ke Frozen Balance | ✅ | `src/lib/money/refunds.ts:214-225` | `refunds.test.ts` | |
| 66 | Siklus penuh Requested → AwaitingDonorDetails → Approved → Processing → Completed, Rejected, Failed; tautan bertanda tangan 30 hari; cek rekening oleh Verifier | 🟡 | Enum lengkap `prisma/schema.prisma:353-361`; kode hanya REQUESTED→APPROVED `refunds.ts:23-27` | `refunds.test.ts` | Tiket 32 |
| 67 | Aturan dua orang: pembuat ≠ penyetuju; penyetuju ≠ penyelesai | 🟡 | `refunds.ts:254-256`; penyelesaian belum ada | `.../refunds/[id]/approve/route.test.ts` | |
| 68 | Refund tidak pernah membuat Campaign Balance negatif; urutan Escrow → Balance → platform | ⚠️ | `createRefund` mendebit satu sumber tanpa cek saldo `refunds.ts:218-225`; sumber dipilih dari `escrowReleasedAt` saja `refunds.ts:120-126` | — | Saldo bisa negatif di antara create dan approve; kekurangan baru ditutup `REFUND_COST` saat approve (`refunds.ts:304`) |
| 69 | Refund sebagian ≤ Gross; fee proporsional dibulatkan ke atas dengan batas kumulatif | ✅ | `refunds.ts:200-212`; `ledger.ts:327-339` | `ledger.test.ts` | |
| 70 | Platform Fee ikut dikembalikan | ❌ | Dipaku 0 `refunds.ts:219, 293` | — | Konsisten karena fee memang belum ada |
| 71 | Batas per Kind; pengalihan dana zakat/wakaf/hibah yang disuspensi ke Campaign Kind sama | ❌ | Tidak ada Kind | — | Tiket 33 |
| 72 | Penyelesaian dengan bukti; kliring refund didebit, saldo penyedia dikredit | ❌ | `REFUND_CLEARING` tak pernah didebit | — | |
| 73 | Email ke Donor di tiga titik; Fundraiser diberi tahu | ❌ | — | — | |
| 74 | Laporan Campaign Expired/Completed yang memegang saldo >60 hari (§7.3) | ❌ | — | — | Tiket 37 |

### 2.7 Wakaf, Zakat, Hibah, CSR (FFI-08, 08a, 08b, 09, 10)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 75 | Wakaf tunai sebagai Kind, kategori, ikrar, Akad Wakaf per Donation | ❌ | Tile `comingSoon` `src/lib/home/quickActionTiles.ts:33` | — | |
| 76 | Asset Waqf Inquiry | ❌ | — | — | |
| 77 | Kalkulator zakat | ✅ | `src/lib/utils/zakat.ts`; `src/app/api/zakat/calculate/route.ts` | `src/lib/utils/zakat.test.ts`, `zakat.property.test.ts`, `src/app/zakat/page.test.tsx` | |
| 78 | Kind `zakat` hanya oleh pemegang Kind Authorisation; nama organisasi sebagai Fundraiser | ❌ | — | — | Tiket 09, 11 |
| 79 | Halaman zakat mengarah ke Campaign zakat | ⚠️ | `category: 'zakat' OR 'kemanusiaan'` `src/app/api/zakat/campaigns/route.ts:12-18`; tombol bayar `src/app/zakat/page.tsx:90-95` membuka `/explore/all?category=zakat&amount=…` yang tidak membaca query | `src/app/api/zakat/campaigns/route.test.ts` | Zakat bisa mengalir ke Campaign non-amil |
| 80 | Hibah sebagai Kind keempat | ❌ | Tile `comingSoon` `quickActionTiles.ts:34` | — | Spec `.scratch/csr-and-hibah/spec.md`, tanpa tiket |
| 81 | Portofolio CSR, Program per Sector, Program Balance | ❌ | — | — | |
| 82 | Partnership Inquiry | ❌ | — | — | |

### 2.8 Volunteer (FFI-11, FFI-12, Fase 3)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 83 | Katalog Volunteer Trip dan Batch | 🟡 | API `src/app/api/volunteer-trips/**`; skema `prisma/schema.prisma:657-710` | `src/app/api/volunteer-trips/**/route.test.ts` | Tidak ada halaman UI sama sekali di `src/app/` |
| 84 | Registration terkonfirmasi hanya setelah Settlement; kuota | ✅ | `src/app/api/webhooks/[provider]/route.ts:278-322`; HOLD `…/registrations/route.ts:11, 140` | `src/lib/volunteer/registration.test.ts`, `…/registrations/route.test.ts` | Jendela hold 30 menit dipilih di kode, padahal PRD §13 masih terbuka |
| 85 | Batch batal karena kuota minimum: refund penuh; pembatalan sendiri bertingkat | ✅ | `src/lib/volunteer/refunds.ts` (≥14 hari 100%, ≥3 hari 50%, <3 hari 0) | `src/lib/volunteer/refunds.test.ts`, `src/app/api/registrations/[id]/route.test.ts` | Ambang dipilih di kode; PRD §13 menyebutnya masih terbuka |
| 86 | Tidak ada Platform Fee atas Trip Fee | ✅ | `paymentSettledLegs` tanpa fee platform `ledger.ts:367-390` | `ledger.test.ts` | |
| 87 | Sertifikat digital dan rekam Registration | 🟡 | `GET /api/registrations/mine` `src/app/api/registrations/mine/route.ts` | `…/mine/route.test.ts` | Sertifikat tidak ada |

### 2.9 Dashboard, Impact, dwibahasa, privasi, pengaturan, penyedia (FFI-13 sampai FFI-18, §7.1)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 88 | Riwayat Donation dan Campaign milik saya | ✅ | `src/app/donasi-saya/page.tsx:50`; `src/app/api/donations/mine/route.ts:22`; `src/app/akun/kampanye-saya/page.tsx` | — | |
| 89 | Kirim ulang dan cetak Receipt | ❌ | — | — | Tiket 21 |
| 90 | Guest Donor mengklaim riwayat setelah email akun diverifikasi | ❌ | Registrasi tanpa verifikasi email `src/app/api/auth/register/route.ts`; Donation tanpa email | — | Tiket 23 |
| 91 | Fundraiser melihat Escrow Hold, Campaign Balance, daftar Donation | ❌ | `escrowBalance` tidak dipakai UI (`ledger.ts:240-262`) | — | |
| 92 | Halaman Impact & Transparency, enam baris | ❌ | — | — | Tiket 25 |
| 93 | Dwibahasa; kunci terjemahan sejak Fase 1 | ❌ | grep i18n kosong | — | |
| 94 | Anonimisasi identitas Donor | ❌ | — | — | Tiket 36 |
| 95 | Pengaturan Platform Fee, ambang, Escrow Hold, metode dari panel dengan audit | ❌ | `ESCROW_HOLD_DAYS = 7` `src/lib/money/escrow.ts:14` | — | Tiket 17 |
| 96 | Antarmuka penyedia tunggal; webhook per penyedia dengan tanda tangan; Payment mencatat penyedia | ✅ | `src/lib/payments/types.ts:106-147`; `src/lib/payments/index.ts:70-97`; `src/app/api/webhooks/[provider]/route.ts:61-97`; `src/app/api/donations/route.ts:218-231` | `src/lib/payments/index.test.ts`, `sumopod-signature.test.ts`, `signature.test.ts` | |
| 97 | Admin mengaktifkan penyedia dari dashboard; rekonsiliasi per penyedia | ❌ | Pilihan penyedia dari env `PAYMENT_PROVIDER` `src/lib/payments/index.ts:93` | — | Tiket 39 |
| 98 | Dokumen wajib per Kind sebagai konfigurasi panel (§7.1) | ❌ | — | — | |

### 2.10 Siklus hidup Campaign (§8)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 99 | Delapan status | ✅ | `prisma/schema.prisma:132-141`; migrasi `20260920101043_add_campaign_lifecycle` | `src/__tests__/lifecycle-migration.test.ts`, `campaign-status-dual-write.test.ts` | Kolom string lama `status` masih jadi sumber untuk katalog dan antrean |
| 100 | Hanya Active menerima Donation | ✅ | `src/lib/campaign-lifecycle.ts:37-41`; `src/app/api/donations/route.ts:107-112` | `route.enum-gate.test.ts` | |
| 101 | Expired otomatis saat tenggat lewat | ❌ | Tidak ada penulis EXPIRED untuk Campaign; donasi tetap diterima setelah tenggat (tidak ada cek `deadline` di `donations/route.ts`) | — | `src/lib/utils/campaign-status.ts:14` hanya menghitung label tampilan |
| 102 | Target tercapai tidak menutup Campaign | ⚠️ | `src/app/api/webhooks/[provider]/route.ts:342-360` | Dikunci salah oleh `route.test.ts:396-405` dan `donation-flow.test.ts:290-293` | |
| 103 | Cancelled: diajukan Fundraiser, disetujui Admin, dibedakan dari Suspended di halaman | ❌ | — | — | Tiket 30 |

### 2.11 Metrik (§5) dan kebutuhan non-fungsional (§9)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 104 | Instrumentasi lima metrik (kunjungan, waktu donasi, donatur berulang, waktu verifikasi, ketepatan pelaporan) | ❌ | Tidak ada pelacakan kunjungan, email Donor, `paid_at` penyedia, stempel VR, maupun Usage Report | — | Tidak satu metrik pun bisa dihitung |
| 105 | Web responsif, mobile first | ✅ | `src/components/layout/BottomNavBar.tsx`; `playwright.config.ts` viewport 375/768/1280 | `tests/e2e/main-flows.spec.ts` (tidak dijalankan) | |
| 106 | LCP <2,5 detik p75 pada 4G | ❓ | — | — | Tidak diukur |
| 107 | 500 donasi bersamaan tanpa gagal dan tanpa ledger tak seimbang | ❓ | Invarian seimbang dijaga `ledger.ts:145-153`; tidak ada uji beban | — | |
| 108 | Kind Authorisation bertanggal, pengingat 30 hari, auto-stop donasi | ❌ | — | — | |
| 109 | Penanda audit >Rp500 juta; Donation tunggal >Rp50 juta ditandai | ❌ | — | — | |
| 110 | Ekspor laporan penghimpunan dan penyaluran per Campaign | ❌ | — | — | |
| 111 | Provider Fee dibaca dari payload, tidak diasumsikan nol | ✅ | `src/lib/payments/sumopod-provider.ts:195`; `route.ts:242` | `sumopod-provider.test.ts` | Untuk Sumopod. Adapter mock tidak melapor fee |
| 112 | Saldo penyedia sebagai akun buku besar per penyedia; penarikan dimodelkan | 🟡 | `GATEWAY_CLEARING` tunggal `prisma/schema.prisma:388` | — | Tidak per penyedia; tidak ada penarikan |
| 113 | Entri buku besar dipisah per Kind dan per penyedia; rekening penghimpunan per Kind | ❌ | `LedgerEntry` tanpa Kind/penyedia `prisma/schema.prisma:579-613` | — | Tiket 35 |
| 114 | Rekonsiliasi harian manual dicatat | 🟡 | Laporan baca-saja `src/app/api/admin/reconcile/route.ts:82` | `src/app/api/admin/reconcile/route.test.ts` | Tidak ada tempat mencatat hasil pembacaan dashboard; tanpa UI |
| 115 | Semua nominal bilangan bulat rupiah | ✅ | `ledger.ts:106-110`; `Int` di skema | `ledger.test.ts`, `src/lib/utils/currency.property.test.ts` | |
| 116 | Enkripsi kolom email, telepon, nomor rekening | ❌ | `User.email` polos `prisma/schema.prisma:31`; `BankAccount.accountNumber` "Stored in full" `:510-512` | — | Tiket 15-16 |
| 117 | Akses panel berbasis penugasan Verifier/Admin | 🟡 | Moderasi dan API admin: penugasan. Halaman admin, middleware, PATCH/DELETE Campaign, dan kini jalur menjadi Fundraiser (`/admin/users` mengubah Role): peran | lihat ADR 0005 | |
| 118 | Operasi saldo mengunci baris Campaign, transisi uang berpredikat | ✅ | `payouts.ts:273-305`; `refunds.ts:172-178, 306-312`; `escrow.ts:202-244`; webhook `route.ts:253-262` | `payouts.test.ts`, `escrow.test.ts`, `refunds.test.ts` | |
| 119 | Transisi status Campaign berpredikat | ⚠️ | Moderasi `update` tanpa `where status` `src/app/api/moderasi/campaigns/[id]/route.ts:52-55`. PATCH tidak lagi bisa mengubah status sejak `b44f803` | — | Verifier bisa "approve" Campaign SUSPENDED/COMPLETED/EXPIRED |
| 120 | Buku besar hanya tambah | ✅ | Tidak ada `ledgerEntry.update/delete` di `src/` | `ledger.test.ts` | |
| 121 | Audit pelaku dan waktu untuk VR, Payout, Suspension, Refund, Manual Contribution, Usage Report | 🟡 | Payout `approvedById/approvedAt` `prisma/schema.prisma:554-556`; Refund `requestedById/approvedById`; penugasan `AssignmentAuditEntry` | `route.assignments-unaffected.test.ts` | VR dan Suspension tanpa audit |
| 122 | Stack Next.js, Prisma, Postgres | ✅ | `package.json` (next 14.2.35, prisma 7.8, pg) | — | |
| 123 | Sumopod QRIS, halaman ter-hosting, webhook svix HMAC | ✅ | `src/lib/payments/sumopod-signature.ts`; `sumopod-provider.ts:155-198` | `sumopod-signature.test.ts`, `sumopod-provider.test.ts` | |
| 124 | Email transaksional sejak Fase 0 | ❌ | Tidak ada mailer | — | Tiket 13 |
| 125 | Penyimpanan dokumen | 🟡 | `public/uploads`, gambar saja `src/app/api/upload/route.ts:7-8` | `upload/route.test.ts` | Folder publik tak cocok untuk KTP/akta |

### 2.12 Model bisnis (§10) dan gerbang fase (§11)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| 126 | Platform Fee persentase Gross per Kind/Category/Campaign | ❌ | Tidak ada leg `PLATFORM_FEE` kredit saat Settlement `ledger.ts:367-390` | — | |
| 127 | Tanpa tip donatur (ADR 0008) | ✅ | `src/app/campaign/[slug]/donate/page.tsx:26-32` | `donate/page.test.tsx` | |
| 128 | Fase 0: satu Campaign lolos Verification Request tanpa intervensi DB | 🟡 | Moderasi approve jalan; entitas VR, checklist, email tidak ada | — | |
| 129 | Fase 1: donasi QRIS nyata end to end dan Receipt diterima | ❌ | Tidak ada Receipt; sakelar default `false` `docker-compose.yml:41` | — | |
| 130 | Fase 2: Payout + Usage Report tanpa intervensi DB; dua penyedia terekonsiliasi | ❌ | Lihat #49, #51, #55, #97 | — | |
| 131 | Fase 3: Volunteer Trip end to end sampai sertifikat | ❌ | Tanpa UI dan sertifikat | — | |

---

## 3. Matriks Dokumen Konsep

Sumber: Dokumen Konsep Platform YIEM (nomor baris merujuk berkas unggahan). Nomor butir memakai awalan K agar tidak tertukar dengan matriks PRD. Bila butir juga diatur PRD, kolom Catatan menunjuk nomor matriks PRD agar bukti tidak ditulis dua kali.

### 3.1 Informasi platform dan prinsip UX (baris 9–15)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| K1 | Fokus: donasi, galang dana, CSR, wakaf, pendaftaran relawan (baris 10) | 🟡 | Donasi dan galang dana ada; CSR/Wakaf `comingSoon` `src/lib/home/quickActionTiles.ts:32-33`; Volunteer hanya API | — | |
| K2 | Target pengguna: individu, komunitas, perusahaan, influencer, filantropi (baris 11) | 🟡 | Sejak `87cce13` tidak ada jalur mandiri untuk menjadi Fundraiser; Admin mendaftarkan secara manual (`src/app/akun/page.tsx:114-133`) | — | Tidak ada jalur perusahaan/CSR; ADR 0010 mempersempit individu (lihat §5 X9) |
| K3 | *Real-time impact tracking* dan pelaporan terbuka (baris 15) | ❌ | Tidak ada halaman Impact, Usage Report, maupun Receipt | — | = PRD #92, #55, #19 |
| K4 | Proses kontribusi cepat, aman, transparan (baris 14) | 🟡 | Alur donasi pendek ada; "aman" dilemahkan C3/C4/C5 (C1 sudah ditutup, C2 sebagian); "transparan" lihat K3 | — | |

### 3.2 Menu utama dan pendukung (baris 19–35)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| K5 | Donasi: pilih campaign terverifikasi, berdonasi langsung | 🟡 | `/explore/all` → `src/app/campaign/[slug]/donate/page.tsx` | `donate/page.test.tsx` | Campaign kini hanya aktif lewat moderasi Verifier (C1 ditutup), tetapi tanpa checklist/Verification Request; lencana "terverifikasi" sudah dihapus dari kartu dan detail (`87cce13`) |
| K6 | Galang Dana: campaign individu/komunitas/influencer | 🟡 | `src/app/campaign/create/page.tsx`; `src/app/api/campaigns/route.ts:107` | `src/app/api/campaigns/route.test.ts`, `src/app/campaign/create/page.test.tsx` | Butuh role Fundraiser yang kini hanya diberikan Admin (`src/app/campaign/create/page.tsx:78-110`) |
| K7 | Kolaborasi CSR: program, portofolio, diskusi | ❌ | Tile `comingSoon` `quickActionTiles.ts:32` | — | = PRD #81-82 |
| K8 | Wakaf produktif/sosial: masjid, sekolah, faskes, fasum | ❌ | Tile `comingSoon` `quickActionTiles.ts:33` | — | = PRD #75 |
| K9 | Volunteer di menu utama: pilih kegiatan, jadwal, daftar | ❌ | Tidak ada di header, footer, maupun homepage (`DesktopHeader.tsx`, `Footer.tsx`, `quickActionTiles.ts`); tidak ada halaman di `src/app/` | — | Digantikan PRD rev. 22 Sep (slot → Hibah, Volunteer → menu pendukung). Terhadap PRD pun tetap celah: menu pendukung juga tidak memuatnya (C18) |
| K10 | Menu pendukung ID: Tentang Kami, Impact & Transparency, Stories, Mitra, FAQ, Hubungi Kami, Masuk/Dashboard | 🟡 | `src/components/layout/Footer.tsx:19-36`; login `DesktopHeader.tsx:142` | `static-pages-accessibility.property.test.ts` | Impact, Stories, Mitra tidak ada = PRD #4 |
| K11 | Menu utama EN: Donate, Start a Fundraiser, CSR Collaboration, Wakaf, Volunteer | ❌ | Tidak ada i18n | — | PRD menunda ke Fase 3 (§5 X6) |
| K12 | Navigasi pendukung EN: About Us … Sign In / Dashboard | ❌ | Tidak ada i18n | — | Sama dengan K11 |

#### 3.2a Rincian per item navigasi (ID dan EN)

Tabel ini merinci K5–K12 per item dan per bahasa. **Tidak dihitung terpisah** dalam hitungan 52 butir, agar item yang sama tidak terhitung dua kali. Status bahasa Inggris semuanya ❌ karena tidak ada i18n sama sekali (grep `next-intl|i18n|useTranslations` di `src/` kosong).

| Item (ID / EN) | Letak di Dokumen Konsep | Status ID | Bukti ID | Status EN | Catatan |
| --- | --- | --- | --- | --- | --- |
| Donasi / Donate | Menu utama, baris 22 / 30 | 🟡 | Link "Donasi" → `/explore/all` `src/components/layout/DesktopHeader.tsx:66-70`; tile `src/lib/home/quickActionTiles.ts:30` | ❌ | "Terverifikasi" hanya berarti lolos moderasi tanpa checklist (lihat K5) |
| Galang Dana / Start a Fundraiser | Menu utama, baris 23 / 31 | ✅ | Link → `/campaign/create` `DesktopHeader.tsx:71-75`; tile `quickActionTiles.ts:31` | ❌ | Item menu ada; Donor tanpa role Fundraiser kini diarahkan ke Admin (`src/app/campaign/create/page.tsx:78-110`) |
| Kolaborasi CSR / CSR Collaboration | Menu utama, baris 24 / 32 | ❌ | Hanya tile `comingSoon` `quickActionTiles.ts:32`; tidak di header | ❌ | |
| Wakaf / Wakaf (EN: Waqf per PRD) | Menu utama, baris 25 / 33 | ❌ | Hanya tile `comingSoon` `quickActionTiles.ts:33` | ❌ | Penulisan EN, lihat §5 X5 |
| Volunteer / Volunteer | Menu utama, baris 26 / 34 | ❌ | Tidak ada di header, footer, maupun tile | ❌ | Digantikan PRD (§5 X2); tetap celah terhadap PRD (C18) |
| (tidak ada di Dokumen Konsep) Zakat | — | ⚠️ | Item header "Zakat" `DesktopHeader.tsx:76-80` | — | Bertentangan dengan PRD §3 baris 38 dan tidak ada di Dokumen Konsep (§5 X4) |
| Tentang Kami / About Us | Menu pendukung, baris 27 / 35 | ✅ | `src/components/layout/Footer.tsx:19` → `src/app/(static)/about/page.tsx` | ❌ | |
| Impact & Transparency / Impact & Transparency | baris 27 / 35 | ❌ | Tidak ada route maupun link | ❌ | = PRD #92 |
| Stories / Stories | baris 27 / 35 | ❌ | Tidak ada route maupun link | ❌ | |
| Mitra / Partners | baris 27 / 35 | ❌ | Tidak ada route maupun link | ❌ | |
| FAQ / FAQ | baris 27 / 35 | ✅ | `Footer.tsx:28` → `src/app/(static)/faq/page.tsx` | ❌ | |
| Hubungi Kami / Contact | baris 27 / 35 | ✅ | `Footer.tsx:29` → `src/app/(static)/contact/page.tsx` | ❌ | |
| Masuk / Dashboard — Sign In / Dashboard | baris 27 / 35 | ✅ | "Masuk" → `/login` `DesktopHeader.tsx:140-145`; dashboard `/akun` via `src/components/layout/BottomNavBar.tsx:59` | ❌ | Dashboard kontributor belum lengkap (PRD #88-91) |

Footer juga memuat tautan yang tidak ada di Dokumen Konsep maupun PRD: Karir, Media, Help Center, Syarat & Ketentuan, Kebijakan Privasi (`Footer.tsx:20-36`). Tidak bertentangan, hanya tambahan.

### 3.3 Alur pengguna (baris 39–64)

| # | Langkah | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| K13 | Donasi 1–2: Campaign → Detail Program | ✅ | `src/app/explore/all/page.tsx`; `src/app/campaign/[slug]/page.tsx` | `CampaignCard.test.tsx`, `CampaignDetail.test.tsx` | |
| K14 | Donasi 3: Nominal Donasi | ✅ | `src/components/donation/DonationAmountSelector.tsx`; preset `donate/page.tsx:13` | `DonationAmountSelector.test.tsx` | Minimum hanya di klien (PRD #11) |
| K15 | Donasi 4: Data Donor | ❌ | Hanya opsi anonim dan pesan; tidak ada email/nama untuk Guest Donor `src/app/api/donations/route.ts:35-43` | — | = PRD #13 |
| K16 | Donasi 5: Pembayaran | 🟡 | QRIS Sumopod `sumopod-provider.ts:105-153` | `sumopod-provider.test.ts` | Sakelar mati secara default `docker-compose.yml:41` |
| K17 | Donasi 6: Receipt & Impact Update | ❌ | Tidak ada mailer; `notifyCampaignUpdate` tanpa pemanggil `src/lib/notifications.ts:77` | — | = PRD #19, #26 |
| K18 | Galang Dana 1: Daftar / Login | ✅ | `src/app/(auth)/register/page.tsx`, `src/app/(auth)/login/page.tsx`; `src/app/api/auth/register/route.ts` | `register/route.test.ts`, `login/page.test.tsx` | Tanpa verifikasi email |
| K19 | Galang Dana 2: Buat Campaign | ✅ | `src/app/campaign/create/page.tsx`; `POST /api/campaigns` | `campaigns/route.test.ts`, `CreateCampaignStepIndicator.test.tsx` | Tanpa Kind/dokumen (PRD #30-32) |
| K20 | Galang Dana 3: Verifikasi Tim | 🟡 | Campaign: moderasi Verifier satu-satunya jalan ke ACTIVE sejak PATCH dibatasi `src/app/api/campaigns/[slug]/route.ts:14-19`; identitas: Admin memeriksa di luar platform lalu memberi role `src/app/akun/page.tsx:114-133` | `moderasi/campaigns/[id]/route.test.ts`, `src/app/api/campaigns/[slug]/route.test.ts:352-446`, `src/app/api/user/verify/route.test.ts` | Dulu ⚠️ (C1, C2). Kini tidak bisa dilewati, tetapi tanpa checklist, alasan penolakan, audit, maupun peran Verifier untuk identitas |
| K21 | Galang Dana 4: Publish | ✅ | Moderasi `approve` → active `src/app/api/moderasi/campaigns/[id]/route.ts:10-11, 52-55` | `moderasi/campaigns/[id]/route.test.ts` | Tidak lagi bisa dilakukan Fundraiser sendiri (C1 ditutup). Aksi approve tetap tanpa predikat status (PRD #119) |
| K22 | Galang Dana 5: Sebarkan (Share) | ✅ | `src/components/shared/ShareModal.tsx:26-85` | `ShareModal.test.tsx` | |
| K23 | Galang Dana 6: Fund Collection | 🟡 | Masuk: webhook + ledger. Keluar: Payout tak bisa selesai (C8) | `webhooks/[provider]/route.test.ts`, `payouts.test.ts` | |
| K24 | Galang Dana 7: Laporan Transparansi | ❌ | Tidak ada Usage Report | — | = PRD #55 |
| K25 | CSR 1: Pilih Sektor | ❌ | — | — | |
| K26 | CSR 2: Lihat Portfolio | ❌ | — | — | |
| K27 | CSR 3: Pilih Program | ❌ | — | — | |
| K28 | CSR 4: Discuss with Team | ❌ | — | — | = PRD #82 |
| K29 | CSR 5: Proposal | ❌ | — | — | |
| K30 | CSR 6: Agreement | ❌ | — | — | |
| K31 | CSR 7: Implementation & Report | ❌ | — | — | |
| K32 | Wakaf 1: Pilih Kategori | ❌ | — | — | |
| K33 | Wakaf 2: Pilih Project | ❌ | — | — | |
| K34 | Wakaf 3: Pilih Nominal / Aset | ❌ | — | — | Aset = Asset Waqf Inquiry di PRD (#76) |
| K35 | Wakaf 4: Verifikasi | ❌ | — | — | Lihat §5 X8 |
| K36 | Wakaf 5: Akad / Dokumen | ❌ | — | — | |
| K37 | Wakaf 6: Update Implementasi | ❌ | Campaign Update generik ada, tapi tidak ada Campaign wakaf | — | |
| K38 | Volunteer 1: Browse Event | 🟡 | `GET /api/volunteer-trips` `src/app/api/volunteer-trips/route.ts:59` | `volunteer-trips/route.test.ts` | API saja, tanpa halaman |
| K39 | Volunteer 2: Detail Kegiatan | 🟡 | `GET /api/volunteer-trips/[slug]` `…/[slug]/route.ts:81` | `…/[slug]/route.test.ts` | API saja |
| K40 | Volunteer 3: Pilih Jadwal | 🟡 | Batch API `src/app/api/volunteer-trips/[slug]/batches/route.ts` | `…/batches/route.test.ts` | API saja |
| K41 | Volunteer 4: Registrasi | 🟡 | `…/batches/[id]/registrations/route.ts` | `…/registrations/route.test.ts` | Berbayar (Trip Fee), bukan pendaftaran gratis seperti di Dokumen Konsep, lihat §5 X2 |
| K42 | Volunteer 5: Konfirmasi | 🟡 | CONFIRMED setelah Settlement `webhooks/[provider]/route.ts:278-284`; notifikasi in-app `notifyRegistrationConfirmed` | `webhooks/[provider]/route.test.ts` | Tanpa email |
| K43 | Volunteer 6: Join Activity | 🟡 | Batch ditandai COMPLETED `…/batches/[id]/route.ts:197-204` | `…/batches/[id]/route.test.ts` | Tidak ada pencatatan kehadiran per Volunteer |
| K44 | Volunteer 7: Certificate / Impact Record | 🟡 | `GET /api/registrations/mine` | `registrations/mine/route.test.ts` | Sertifikat tidak ada = PRD #87 |

### 3.4 Sektor CSR dan format halaman Program (baris 68–80)

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| K45 | Empat kartu sektor: Kesehatan, Pendidikan, Lingkungan, Disabilitas | ❌ | Tidak ada model Program/Sector | — | Kategori Campaign (`Category`) bukan Sector, sesuai CONTEXT.md |
| K46 | Halaman Program: Problem → Target Beneficiaries → Location → Activities → Budget → Timeline → KPI → Documentation → Impact Report → CTA "Discuss with Our Team" | ❌ | — | — | = PRD FFI-09 |

### 3.5 Homepage (baris 84–89) dan dwibahasa

| # | Kebutuhan | Status | Bukti | Tes | Catatan |
| --- | --- | --- | --- | --- | --- |
| K47 | Headline "Connecting Generosity with Real Impact in Indonesia." | ❌ | Headline banner berbeda `src/app/page.tsx:34, 39, 44` | `HeroBanner.test.tsx` | |
| K48 | CTA utama Donate Now | ✅ | "Donasi Sekarang" → `/explore/all` `src/app/page.tsx:35` | `HeroBanner.test.tsx` | Versi Indonesia |
| K49 | CTA sekunder: Start a Fundraiser • CSR Collaboration • Waqf • Volunteer | 🟡 | Galang Dana berfungsi; CSR/Wakaf `comingSoon`; Volunteer diganti Hibah `quickActionTiles.ts:29-35` | `quickActionTiles.test.ts` | Penggantian Volunteer → Hibah mengikuti PRD (§5 X2, X3). Banner juga mempromosikan "Bayar Zakat" `page.tsx:39-40`, yang tidak ada di Dokumen Konsep maupun daftar CTA PRD |
| K50 | Elemen kepercayaan: Verified programs • Transparent reporting • Measurable impact | ❌ | Sejak `87cce13` lencana "terverifikasi" dihapus (`VerificationBadge.tsx` dihapus; kartu `src/components/campaign/CampaignCard.tsx`, detail `CampaignDetail.tsx`, `CampaignDetailView.tsx`); tidak ada pelaporan maupun angka dampak | `CampaignCard.test.tsx`, `CampaignDetail.test.tsx`, `CampaignDetailView.test.tsx` (memastikan tidak ada klaim) | Dulu ⚠️ (klaim palsu), kini ❌ (tidak ada klaim sama sekali). Lebih jujur, tetapi elemen kepercayaan Dokumen Konsep belum terpenuhi (C19) |
| K51 | Versi Bahasa Indonesia | ✅ | Seluruh UI berbahasa Indonesia | — | |
| K52 | Versi Bahasa Inggris paralel | ❌ | Tidak ada i18n | — | PRD menunda ke Fase 3 (§5 X6) |

---

## 4. Matriks ADR 0001–0014

| ADR | Keputusan | Status | Bukti | Pelanggaran / celah |
| --- | --- | --- | --- | --- |
| 0001 | Tetap di Next.js, Prisma, Postgres | ✅ | `package.json` (next 14.2.35, @prisma/client 7.8, pg) | — |
| 0002 | Satu entitas Campaign membawa semua uang daring, dibedakan Kind; Program tidak menerima uang | 🟡 | Donation hanya ke Campaign `prisma/schema.prisma:206-228` | Kind tidak ada, jadi "dibedakan Kind" belum terwujud; Program belum ada |
| 0003 | Satu penyedia untuk koleksi dan payout | N/A (superseded ADR 0006) | Adapter mock bergaya Midtrans dan kontrak payout bergaya Xendit dipertahankan `src/lib/payments/types.ts:86-104`, sesuai 0006 | — |
| 0004 | Keep-it-all; tenggat lewat → EXPIRED; target tercapai tidak menutup; hanya Fundraiser/Admin menandai COMPLETED | ⚠️ | — | Webhook auto-complete saat target tercapai `route.ts:342-360`, dikunci dua tes; EXPIRED tak pernah ditulis dan donasi tetap diterima setelah tenggat. Di `450ede5` Fundraiser juga bisa set `status` apa pun lewat PATCH; sejak `b44f803` tidak lagi, tetapi kini tidak ada jalan sah bagi Fundraiser/Admin untuk menandai COMPLETED, sehingga webhook satu-satunya jalan ke COMPLETED (C20) |
| 0005 | Verifier dan Admin penugasan terpisah; aturan dua orang berlaku per orang | 🟡 | `UserAssignment` `prisma/schema.prisma:71-81`; `withAssignmentCheck` di API admin, moderasi, approve payout/refund; `AssignmentAuditEntry` | `src/app/admin/layout.tsx:12` dan `src/app/admin/page.tsx:8` cek `role === "ADMIN"`; middleware masih hirarki `src/middleware.ts:7-20` (pemegang VERIFIER dengan role DONOR tertolak sebelum layout); PATCH/DELETE Campaign pakai `role === "ADMIN"` `src/app/api/campaigns/[slug]/route.ts:134, 212`; halaman `/admin/users` masih mengedit Role `src/app/admin/users/page.tsx:102-105`, dan sejak `87cce13` itulah satu-satunya jalan menjadi Fundraiser, tanpa audit (hanya penugasan yang diaudit, bukan Role); kapasitas pelaku tidak tercatat pada Payout/Refund |
| 0006 | Lapisan penyedia netral, Sumopod dulu | 🟡 | Antarmuka, webhook per penyedia bertanda tangan, `Payment.provider`, fee dari payload, approval Payout tanpa panggilan penyedia (`payouts.ts:177-207`) | Akun saldo per penyedia tidak ada (`GATEWAY_CLEARING` tunggal); penyelesaian Payout dengan bukti tidak ada; validasi nama rekening manual tidak punya route; aktivasi penyedia lewat env, bukan dashboard; rekonsiliasi tidak per penyedia |
| 0007 | Refund mengembalikan Gross; platform menanggung Provider Fee | 🟡 | `refundRequestedLegs`/`refundApprovedLegs` `ledger.ts:431-497`; `REFUND_COST` | Siklus berhenti di APPROVED; `REFUND_CLEARING` tak pernah dikosongkan; saldo sumber bisa negatif sementara (§2.6 #68) |
| 0008 | Tanpa tip donatur | ✅ | `donate/page.tsx:26-32`; biaya admin kosmetik dihapus (`docs/integrasi-sumopod.md`) | — |
| 0009 | Dioperasikan PT Jaya Korpora Prima; Platform Operator ≠ Partner Organisation; akun merchant ≠ rekening penghimpunan | ❌ | Hanya teks di `src/app/(static)/press/page.tsx:14` | Tidak ada model Partner Organisation, rekening penghimpunan, maupun pemisahan akun |
| 0010 | Setiap Campaign menyebut Collecting Entity; Kind hanya terbuka bila izin berlaku; Fundraiser perorangan butuh sponsor | ⚠️ | — | Tidak ada Collecting Entity/Fundraising Permit; Fundraiser perorangan (di `87cce13` didaftarkan Admin secara manual, dulu swa-verifikasi KTP) bisa membuka Campaign tanpa sponsor, yang oleh ADR ini dilarang |
| 0011 | Akun merchant tidak dibagi dengan Makam.co.id | 🟡 | Kredensial per deployment dari env `src/lib/payments/index.ts:70-78` | Invarian rekonsiliasi (`Provider Balance = GATEWAY_CLEARING − penarikan`) belum bisa dinyatakan karena penarikan tidak dimodelkan; tidak bisa diverifikasi dari kode bahwa akun Sumopod tidak dipakai bersama |
| 0012 | HMAC untuk email, enkripsi acak untuk telepon dan rekening, nama polos, dua kunci ber-key-id | ❌ | `User.email` polos `@unique`; `User.phone` polos; `BankAccount.accountNumber` polos dengan komentar "Stored in full" `prisma/schema.prisma:510-512` | Tidak ada kolom HMAC, ciphertext, maupun key id; log akses panel juga tidak ada |
| 0013 | Hibah Kind keempat, sementara mengikuti Wakaf | ❌ | Tile `comingSoon` | Tidak ada Kind sama sekali |
| 0014 | Volunteer Trip entitas terpisah yang memakai primitif Payment/ledger/escrow/payout | 🟡 | `VolunteerTrip`/`VolunteerBatch`/`Registration` `prisma/schema.prisma:643-744`; `LedgerSubject` `ledger.ts:47-59`; `TRIP_BALANCE`; moderasi trip `src/app/api/moderasi/volunteer-trips/[id]/route.ts:19` | Ambang refund (14/3 hari) dan hold 30 menit dipilih di kode padahal ADR/PRD §13 menyatakan terbuka; jalur Trip Fee melewati sakelar dan pengaman donasi (C5); tanpa UI |

---

## 5. Konflik antar sumber

**Aturan resolusi yang dipakai.** PRD revisi 22 September 2026 menyatakan dirinya sebagai turunan deck "Website Menu & User Flow, Makam.co.id × Fund for Indonesia" (PRD baris 4) dan memetakan slide 2, 6, 7, 8, 9, 10 ke pasalnya (PRD §14, baris 384-391). Isi Dokumen Konsep cocok dengan pemetaan itu (lima menu ID/EN, lima alur, empat sektor, format halaman Program, rekomendasi homepage), jadi saya memperlakukannya sebagai teks sumber yang **lebih tua** daripada PRD. Saya tidak bisa memastikan Dokumen Konsep adalah deck yang sama persis (❓), karena berkas tanpa tanggal dan tanpa nomor slide. Karena itu:

1. Bila PRD atau ADR secara eksplisit mencatat keputusan pemilik produk yang mengubah isi deck, PRD/ADR menang. Konfliknya **terselesaikan dengan bukti**.
2. Bila PRD/ADR sendiri menandai keputusannya sebagai sementara atau masih terbuka, konfliknya **dibiarkan terbuka untuk user**.
3. Bila kode menyimpang dari semua sumber, itu celah, bukan konflik sumber.

| # | Konflik | Sumber yang bertentangan | Resolusi | Bukti | Status |
| --- | --- | --- | --- | --- | --- |
| X1 | Siapa organisasi platform: Dokumen Konsep berkepala "Yayasan Indonesia Emas Merdeka (YIEM)", sedangkan ADR 0009 dan `CLAUDE.md` menyebut operatornya PT Jaya Korpora Prima | Dokumen Konsep baris 3 vs ADR 0009, `CLAUDE.md:3`, PRD baris 3, CONTEXT.md baris 3, 81-87 | **Terselesaikan.** Bukan kontradiksi langsung: Dokumen Konsep hanya menyebut YIEM sebagai penulis, tidak menyatakan siapa pemegang platform. Keputusan 19 Sep 2026 (PRD §13 baris 354) menetapkan PT Jaya Korpora Prima sebagai Platform Operator dan YIEM sebagai Partner Organisation pertama. Keputusan ini eksplisit dan lebih baru. | PRD baris 3, 22, 354; ADR 0009; halaman `src/app/(static)/press/page.tsx:14` sudah menyebut PT Jaya Korpora Prima | Terselesaikan untuk penamaan. **Tetap terbuka:** siapa pemegang izin penghimpunan. PRD §13 baris 378 dan ADR 0009 mewajibkan penasihat hukum memastikan hal ini sebelum rilis, dan ADR 0010 bergantung padanya. Kode belum memodelkan Platform Operator maupun Partner Organisation, jadi keputusan itu belum punya tempat di sistem |
| X2 | Volunteer di menu utama (Dokumen Konsep) vs keluar dari menu utama (PRD, commit `8eb7dcd`); pendaftaran relawan gratis (Dokumen Konsep) vs Trip Fee berbayar (ADR 0014) | Dokumen Konsep baris 26, 34, 61-64, 88 vs PRD §3 baris 26, 36; §14 baris 420-421, 425; ADR 0014; commit `8eb7dcd` | **Terselesaikan untuk menu dan model uang.** PRD rev. 22 Sep mengganti slot menu kelima Volunteer dengan Hibah "atas keputusan pemilik produk, di luar isi deck" (baris 382, 420), memindahkan Volunteer ke menu pendukung (baris 36), dan menjadikannya berbayar (baris 361, 425; ADR 0014). Commit `8eb7dcd` mengikuti PRD dengan benar untuk tile homepage. **Namun kode belum menjalankan setengah keputusan itu:** PRD mewajibkan Volunteer di menu pendukung, dan `Footer.tsx`/`DesktopHeader.tsx` tidak memuatnya. Akibatnya Volunteer kini tidak bisa dicapai dari navigasi mana pun (C18) | `git show 8eb7dcd` (pesan: "Volunteer moves to a secondary menu"); `src/components/layout/Footer.tsx:19-36`; `DesktopHeader.tsx:67-89` | Terselesaikan (PRD menang). **Terbuka untuk user:** apakah YIEM sebagai penulis Dokumen Konsep sudah menyetujui perubahan di luar deck ini. PRD hanya menyebut "pemilik produk", dan saya tidak menemukan bukti persetujuan YIEM di repo |
| X3 | Hibah tidak ada di Dokumen Konsep; ADR 0013 dan PRD menjadikannya Kind keempat dan menu utama kelima | Dokumen Konsep baris 22-26, 88 vs ADR 0013; PRD §3 baris 34, §13 baris 358, 360 | **Terselesaikan sebagai keputusan pemilik produk** (PRD baris 358, 420). | ADR 0013; PRD §14 baris 420 | **Terbuka untuk user:** aturan Hibah (Kind Authorisation, batas Refund, dokumen wajib) ditandai sendiri oleh ADR 0013 dan PRD §13 baris 368-371 sebagai asumsi sementara yang menunggu penasihat syariah "sebelum Kind `hibah` menerima donasi nyata". Kode belum punya Hibah, jadi belum ada risiko uang; risikonya ada saat implementasi |
| X4 | Zakat tidak ada di Dokumen Konsep; kode punya `/zakat` | Dokumen Konsep (tidak ada) vs PRD §3 baris 30, 38; §14 baris 395; kode `src/app/zakat/` | **Terselesaikan untuk keberadaan zakat:** PRD 19 Sep menambahkan zakat "sebagai Kind keenam, di bawah menu Donasi" dengan persetujuan pemilik produk (baris 393-395). **Tetapi kode bertentangan dengan PRD dalam cara menampilkannya:** zakat punya item header sendiri (`DesktopHeader.tsx:79`), banner homepage "Zakat lebih mudah dan terpercaya" (`src/app/page.tsx:37-41`), dan daftar Campaign zakat memasukkan kategori `kemanusiaan` tanpa Kind Authorisation (`src/app/api/zakat/campaigns/route.ts:12-18`) | PRD baris 38 ("Zakat tidak menjadi menu tersendiri"); C7 | Terselesaikan antar dokumen; celah kode dicatat di PRD #3, #79 dan C7. **Rekomendasi untuk diputuskan user:** sembunyikan pintu masuk zakat (header, banner) sampai tiket 09/11 selesai, karena klaim "terpercaya" tanpa amil berizin adalah risiko syariah dan reputasi |
| X5 | Penulisan Wakaf di menu Inggris: Dokumen Konsep memakai "Wakaf" di menu EN (baris 33) tetapi "Waqf" di CTA homepage (baris 88) | Dokumen Konsep (tidak konsisten dengan dirinya sendiri) vs PRD §3 baris 38 | **Terselesaikan:** PRD memutuskan "Wakaf" untuk ID, "Waqf" untuk EN, slug `/wakaf` di kedua bahasa (PRD baris 38, §13 baris 351) | PRD baris 38 | Terselesaikan. Kode belum punya keduanya |
| X6 | Dwibahasa: Dokumen Konsep menyajikan ID dan EN berdampingan; PRD menunda EN ke Fase 3 | Dokumen Konsep baris 21-35 vs PRD §6 baris 96, §9 baris 299, §13 baris 352, §14 baris 409 | **Terselesaikan:** keputusan 19 Sep menunda EN ke Fase 3 dan mewajibkan kunci terjemahan sejak Fase 1 | PRD baris 96, 299 | Terselesaikan. Celah terhadap PRD tetap ada: tidak ada kunci terjemahan (PRD #93) |
| X7 | Jumlah jalur kontribusi: Dokumen Konsep lima (donasi, galang dana, CSR, wakaf, volunteer); PRD tujuh (menambah zakat dan hibah); PRD §14 baris 395 menyebut zakat "Kind keenam" padahal CONTEXT.md hanya punya empat Kind | Dokumen Konsep baris 10 vs PRD §5 baris 57, §14 baris 395, 424; CONTEXT.md baris 17-19 | **Terselesaikan sebagian:** "tujuh jalur" (PRD baris 57, 424) menang. "Kind keenam" di baris 395 kemungkinan maksudnya jalur kontribusi keenam, bukan Kind; CONTEXT.md dan ADR 0013 jelas menyebut empat Kind | PRD baris 57, 395; CONTEXT.md baris 17-19 | **Terbuka (kecil):** perbaiki kata "Kind keenam" di PRD agar tidak dibaca sebagai enam Kind |
| X8 | Alur Wakaf: Dokumen Konsep menggabungkan nominal/aset, "Verifikasi", dan "Akad / Dokumen" dalam satu alur; PRD memisahkan wakaf tunai (ikrar lewat centang, Akad Wakaf otomatis) dari wakaf aset (Asset Waqf Inquiry, akad manual oleh nazhir) | Dokumen Konsep baris 56-59 vs PRD §8 baris 265, FFI-08 | **Terselesaikan sebagai penajaman PRD.** Langkah "Verifikasi" di Dokumen Konsep tidak punya padanan per-Donation di wakaf tunai PRD; saya membacanya sebagai verifikasi aset oleh nazhir di jalur Asset Waqf Inquiry | PRD baris 129, 265 | Terselesaikan, dengan catatan tafsir. Konfirmasi ke user bila "Verifikasi" dimaksudkan untuk wakaf tunai juga |
| X9 | Siapa boleh menggalang dana: Dokumen Konsep dan PRD §3 menjanjikan campaign "individu/komunitas/influencer"; ADR 0010 mewajibkan setiap Campaign punya Collecting Entity, sehingga Fundraiser perorangan butuh Partner Organisation sponsor | Dokumen Konsep baris 11, 23 vs PRD §3 baris 31; ADR 0010 Konsekuensi 2 | **Terselesaikan oleh ADR 0010** (lebih baru, alasan hukum). ADR itu sendiri menyatakan ini pembatasan produk yang "the campaign-creation flow has to say so" | ADR 0010; PRD §13 baris 378 | **Terbuka untuk user:** salinan menu "Galang Dana" (ID/EN) dan alur pembuatan belum menyebut syarat sponsor; kode membolehkan individu tanpa sponsor (ADR 0010 ⚠️). Butuh keputusan cara menyampaikannya ke influencer/individu |
| X10 | Payment per Donation: CONTEXT.md membolehkan beberapa Payment per Donation (coba bayar lagi); skema mengizinkan satu | CONTEXT.md baris 126-128, PRD FFI-01 vs `prisma/schema.prisma:407` | Bukan konflik antar dokumen; kode yang menyimpang | PRD #18 | Celah kode |
| X11 | Pemetaan `Payment.providerRef`: `docs/integrasi-sumopod.md` memetakan `payment_id`; kode sengaja memakai `order_id` dengan alasan tertulis | `docs/integrasi-sumopod.md` tabel pemetaan vs `src/lib/payments/sumopod-provider.ts:138-146` | **Terselesaikan ke arah kode:** komentar di adapter menjelaskan kenapa `order_id` benar (webhook mencari Payment berdasarkan `data.order_id`). Dokumen yang basi | `sumopod-provider.ts:138-146` | Perbarui dokumen integrasi |
| X12 | ADR 0002 menyebut Volunteer "a separate entity because no money moves"; ADR 0014 menyatakan uang kini bergerak | ADR 0002 vs ADR 0014 | **Terselesaikan di dokumen itu sendiri:** ADR 0002 diberi catatan pembaruan 22 Sep yang merujuk ADR 0014 | ADR 0002 paragraf "Update" | Terselesaikan |

**Ringkasan konflik:** 12 konflik diperiksa. Tujuh terselesaikan penuh dengan bukti (X5, X6, X10, X11, X12, serta X1 dan X4 di tingkat dokumen). Lima menyisakan keputusan terbuka untuk user: pemegang izin penghimpunan (X1), persetujuan YIEM atas perubahan di luar deck (X2), aturan syariah Hibah (X3), cara menampilkan zakat sebelum Kind Authorisation ada (X4), dan salinan syarat sponsor bagi Fundraiser perorangan (X9). X7 dan X8 hanya perlu perbaikan kata atau konfirmasi tafsir.

---

## 6. Celah dan risiko

Format tiap celah: tingkat · sumber pemilik · bukti · mengapa penting · langkah berikut.

### C1. Mass assignment pada PATCH Campaign — Kritis di `450ede5` · **TERTUTUP di `b44f803`**
- **Status `87cce13`:** tertutup. Lihat §1a untuk bukti dan tes. Teks di bawah adalah temuan asli di `450ede5`, dipertahankan sebagai riwayat; nomor baris di dalamnya merujuk `450ede5`.
- **Sumber:** PRD FFI-05 (perubahan Active butuh VR baru), §8 siklus hidup; ADR 0004.
- **Bukti:** `src/app/api/campaigns/[slug]/route.ts:135-146` menyebar `...rest` dari body ke `prisma.campaign.update`; hanya `lifecycleStatus` dibuang, lalu `status` string dipetakan balik ke `lifecycleStatus`. Pemilik dengan role ≥ CAMPAIGN_CREATOR lolos (`:122-133`).
- **Dampak:** Fundraiser bisa mengaktifkan Campaign SUBMITTED/REJECTED miliknya sendiri, mencabut Suspension (`{"status":"active"}`), mengubah `targetAmount`/`deadline` tanpa verifikasi, memalsukan `collectedAmount`, menyalakan `isDemo` (padahal skema `prisma/schema.prisma:161-184` menyatakan kode aplikasi tidak boleh), atau memindahkan `creatorId`.
- **Tes:** `route.test.ts` hanya menguji `title` dan status oleh ADMIN; tidak ada tes negatif untuk kolom terlarang.
- **Langkah:** allowlist kolom yang boleh diubah pemilik (judul, cerita, sampul) dan arahkan target/tenggat/rekening ke Verification Request (tiket 12). Perbaikan ini tidak boleh menunggu tiket 12; jadikan tiket keamanan tersendiri.

### C2. Swa-verifikasi identitas Fundraiser — Kritis di `450ede5` · **SEBAGIAN di `87cce13`, kini Tinggi**
- **Status `87cce13`:** jalur swa-verifikasi dan lencana tertutup; sisa (a)–(d) di §1a masih terbuka dan menjadi top-10 #8. Teks di bawah adalah temuan asli di `450ede5`; nomor baris di dalamnya merujuk `450ede5`.
- **Langkah sisa:** migrasi atau skrip terkontrol yang mencabut `isVerified` dan meninjau ulang setiap role `CAMPAIGN_CREATOR` hasil swa-verifikasi; audit perubahan Role; pindahkan pemeriksaan identitas ke Verifier bersama tiket 12; perbarui salinan bantuan/FAQ/syarat.
- **Sumber:** PRD §6 ("Verifikasi identitas Fundraiser sebelum publish"), FFI-05, §9 Anti penyalahgunaan; ADR 0010.
- **Bukti:** `src/app/api/user/verify/route.ts:54-63` langsung menulis `isVerified: true`, `role: 'CAMPAIGN_CREATOR'` untuk NIK 16 digit atau nomor registrasi ≥5 karakter apa pun. Data tidak disimpan. Lencana publik "Identitas terverifikasi (KTP)" `src/components/shared/VerificationBadge.tsx:34-35`.
- **Dampak:** lencana kepercayaan di halaman Campaign tidak berarti apa-apa. Digabung dengan C1, siapa pun bisa mempublikasikan ajakan uang tanpa satu pun manusia di sisi operator.
- **Langkah:** ubah menjadi pengajuan yang diperiksa Verifier (bagian dari tiket 12); sementara itu cabut pemberian role otomatis dan sembunyikan lencana.

### C3. Webhook menutup Campaign saat target tercapai — Kritis
- **Sumber:** ADR 0004, PRD §8, CONTEXT.md "Campaign Status".
- **Bukti:** `src/app/api/webhooks/[provider]/route.ts:342-360`. Tes yang mengunci perilaku salah: `src/app/api/webhooks/[provider]/route.test.ts:396-405`, `src/__tests__/integration/donation-flow.test.ts:290-293`.
- **Dampak:** Campaign berhenti menerima Donation begitu target tercapai. Lebih buruk: karena webhook sengaja menerima Settlement apa pun status Campaign (PRD §7.2), Settlement yang terlambat pada Campaign SUSPENDED atau CANCELLED yang melewati target menimpa statusnya menjadi COMPLETED, menghapus jejak Suspension.
- **Langkah:** hapus cabang `targetMet`; balik kedua tes. Tiket kecil tersendiri, mendahului tiket 30.

### C4. Suspension tidak menahan uang keluar — Kritis
- **Sumber:** FFI-07b, CONTEXT.md "Suspension".
- **Bukti:** tidak ada pembacaan status Campaign di `requestPayout` (`src/lib/money/payouts.ts:110-175`), `approvePayout` (`:209-320`), maupun `releaseMaturedEscrow` (`src/lib/money/escrow.ts:113-303`). Suspension diputuskan Verifier, bukan Admin (`src/app/api/moderasi/campaigns/[id]/route.ts:7-14, 22`), tanpa alasan, dan bisa dibatalkan Verifier yang sama lewat `approve` tanpa predikat status (`:52-55`).
- **Dampak:** Campaign bermasalah tetap bisa dicairkan. Saat ini tertutup secara kebetulan oleh C8 (Payout tidak bisa selesai), bukan oleh desain.
- **Langkah:** tiket 30 (suspension-cancellation) harus mencakup gate di lapisan uang dan pemindahan keputusan ke Admin.

### C5. Trip Fee melewati sakelar donasi dan pengaman sandbox — Tinggi
- **Sumber:** `docs/integrasi-sumopod.md` §Bendera dan pengaman; ADR 0014 (Trip memakai infrastruktur Payment yang sama).
- **Bukti:** `src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts:77-97` memanggil `getPaymentProvider()` tanpa `donationsEnabled()` dan tanpa `sandboxInProductionReason()`; bandingkan `src/app/api/donations/route.ts:48-63`.
- **Dampak:** di produksi dengan kredensial sandbox atau adapter mock, Volunteer bisa membayar ke tagihan yang tidak pernah settle; itulah kasus yang disebut dokumen integrasi "tidak bisa dipulihkan".
- **Langkah:** ekstrak satu gate "boleh menagih uang" yang dipakai kedua route; tambahkan tes.

### C6. Platform Fee tidak ada — Tinggi
- **Sumber:** FFI-01, FFI-17, §10, CONTEXT.md "Platform Fee", ADR 0009 (operator menerima Platform Fee).
- **Bukti:** `paymentSettledLegs` hanya GATEWAY_CLEARING/ESCROW_HOLD/PROVIDER_FEE `src/lib/money/ledger.ts:367-390`; `platformFeePortion = 0` `src/lib/money/refunds.ts:219, 293`; `Payment` tanpa kolom fee platform.
- **Dampak:** tidak ada pendapatan operator; halaman tidak bisa menampilkan fee yang berlaku; pembebasan <Rp50.000 tidak bisa diterapkan.
- **Langkah:** tiket 17. Harus ada sebelum Fase 1 karena setiap Payment wajib membekukan fee saat dibuat; Payment yang dibuat sebelumnya tidak bisa diberi fee mundur.

### C7. Kind, Kind Authorisation, Collecting Entity tidak ada; zakat dicampur — Tinggi (hukum/syariah)
- **Sumber:** ADR 0002, 0009, 0010, 0013; FFI-08, 08a, 08b; §9 Kepatuhan; §13 catatan penasihat hukum.
- **Bukti:** tidak ada kolom Kind di `Campaign` (`prisma/schema.prisma:143-202`). `src/app/api/zakat/campaigns/route.ts:12-18` memasukkan kategori `kemanusiaan` ke daftar zakat. `src/app/zakat/page.tsx:90-95` mengirim ke `/explore/all?category=zakat&amount=…`, tetapi `src/app/explore/all/page.tsx` tidak membaca `searchParams`.
- **Dampak:** zakat Donor bisa jatuh ke Campaign yang dikelola bukan amil; setiap Receipt/akad kelak tidak punya lawan hukum yang benar. Ini risiko reputasi dan kepatuhan yang tidak bisa dibalik setelah uang nyata masuk.
- **Langkah:** tiket 09, 10, 11. Sementara itu hentikan halaman zakat mengarahkan ke Campaign non-zakat.

### C8. Payout tidak bisa diselesaikan tanpa DB — Tinggi
- **Sumber:** FFI-07, ADR 0006, gerbang Fase 2.
- **Bukti:** tidak ada `bankAccount.create`/`update` di `src/` selain tipe generated; tidak ada endpoint COMPLETED (`src/lib/money/payouts.ts:199-207`); tidak ada `GET` Payout Campaign untuk Fundraiser.
- **Dampak:** alur Payout berhenti di APPROVED; `PAYOUT_CLEARING` terus membengkak; laporan rekonsiliasi hanya bisa menampilkannya sebagai anomali (`src/app/api/admin/reconcile/route.ts` bagian `approvedWithoutProviderRef`).
- **Langkah:** tiket 27 (payout-completion) dan 28 (fundraiser-payout-ui), plus pengelolaan Bank Account yang diverifikasi Verifier.

### C9. Escrow Hold dari waktu server — Tinggi
- **Sumber:** FFI-07, `docs/integrasi-sumopod.md` §Waktu dan Escrow, CONTEXT.md "Escrow Hold".
- **Bukti:** `src/app/api/webhooks/[provider]/route.ts:243-244`; konstanta `src/lib/money/escrow.ts:14`; adapter tidak mem-parsing `paid_at`/`settled_at` (`src/lib/payments/sumopod-provider.ts:186-197`).
- **Dampak:** pada penyedia dengan settlement lambat, dana dilepas sebelum masuk; metrik "waktu donasi" memakai waktu yang salah; lama hold tidak dibekukan per Payment sehingga perubahan pengaturan nanti mengubah janji ke Donor lama.
- **Langkah:** tiket 19 (settled-at-escrow-anchor) dan 17.

### C10. Deploy dan kredensial bawaan — Tinggi
- **Bukti:** `deploy.sh:2` (`set -e`), `:20-22` (seed setiap deploy), `:26` (app dijalankan setelah seed). `prisma/seed.ts:207-223` melempar error pada DB berisi. `prisma/seed.ts:78, 245, 554` membuat `admin@kitabisa.com` / `password123` dengan role ADMIN, dan backfill penugasan memberi ADMIN dan VERIFIER.
- **Dampak:** redeploy lewat `deploy.sh` berhenti sebelum app baru dijalankan (tidak bisa dipastikan apakah operator memakai skrip ini; saya tidak menjalankannya). Lingkungan baru (rencana dev/stg/prod di komentar skema) lahir dengan akun admin berkata sandi publik.
- **Langkah:** pisahkan seed dari deploy; seed demo hanya di non-produksi dan tanpa akun berpenugasan.

### C11. Pemilik atau "Admin berperan" bisa menghapus Campaign — Tinggi
- **Sumber:** §9 Audit ("tidak pernah dihapus" untuk jejak uang), ADR 0005, alur Cancelled §8.
- **Bukti:** `src/app/api/campaigns/[slug]/route.ts:183-230` (di `87cce13`) melakukan `prisma.campaign.delete` untuk pemilik atau `role === "ADMIN"`. `Donation.campaign` `onDelete: Cascade` (`prisma/schema.prisma:218`); `Payment.donation` `Restrict` (`:408`) sehingga penghapusan gagal hanya bila sudah ada Payment. Tombol admin mengirim `campaign.id` (`src/app/admin/campaigns/DeleteCampaignButton.tsx:22`, `page.tsx:112-115`) ke route yang mencari berdasarkan `slug`, jadi tombol itu selalu 404.
- **Dampak:** pemilik Campaign Active bisa menghapusnya beserta Donation pending dan Prayer, melewati alur Cancelled yang butuh persetujuan Admin. Tombol admin adalah UI palsu.
- **Langkah:** ganti hapus dengan Cancellation (tiket 30); hapus tombol admin.

### C12. Tidak ada email maupun data kontak Donor — Tinggi
- **Sumber:** FFI-01, 03, 05, 13, 16; §9 Notifikasi (email sejak Fase 0).
- **Bukti:** tidak ada mailer; `Donation` tanpa email (`prisma/schema.prisma:206-228`); `notifyCampaignUpdate`/`notifyPayout` tanpa pemanggil (`src/lib/notifications.ts:77, 116`).
- **Dampak:** gerbang Fase 1 ("Receipt diterima") mustahil; Guest Donor tidak bisa dihubungi untuk Refund (§7.2 AwaitingDonorDetails).
- **Langkah:** tiket 13 (mailer), 21 (receipt); kolom email Donation harus lahir langsung dengan skema ADR 0012 (tiket 15) agar tidak ada migrasi data polos ke terenkripsi.

### C13. Refund bisa membuat saldo sumber negatif sementara — Sedang
- **Sumber:** §7.2 Sumber dana dan batas.
- **Bukti:** `createRefund` mendebit `netPortion` dari satu sumber tanpa membaca saldonya (`src/lib/money/refunds.ts:218-225`); kekurangan baru ditutup `REFUND_COST` saat approve (`:304`, `ledger.ts:492-495`). Urutan "Escrow Hold Payment itu dulu, lalu Campaign Balance, lalu dana platform" direduksi menjadi satu sumber.
- **Dampak:** `negativeBalances` di laporan rekonsiliasi akan menyala untuk Refund yang sah; selama jendela itu Payout lain tertahan (aman, tapi membingungkan).
- **Langkah:** tiket 31 (refund-gross-ledger).

### C14. Katalog menerima `status` dari klien — Sedang
- **Bukti:** `src/app/api/campaigns/route.ts:37, 45` (`status = searchParams.get('status') || 'active'`).
- **Dampak:** `?status=pending` atau `?status=rejected` membuka Campaign yang belum/tidak lolos verifikasi ke publik, dan `?status=suspended` menampilkan Campaign yang PRD minta disembunyikan.
- **Langkah:** kunci ke ACTIVE (dan kelak filter Demo) di sisi server.

### C15. Tiket vs kode — Sedang (proses)
- Tiket berstatus `ready-for-agent` padahal kodenya sudah ada sebagian atau seluruhnya:
  - `prd-compliance-fase-0-2/issues/01` (dompet): route top-up/spend hilang dan model `TopUp` di-drop (migrasi `20260920133450_drop_topup_model`), tapi kolom `donationBalance` tetap. Sebagian.
  - `06-roles-expand`: `UserAssignment` dan backfill ada (migrasi `20260920155350`, `20260920160016`). Selesai secara substansi.
  - `07-roles-migrate-guards`: API admin dan moderasi sudah pindah (commit `54b0fcf`, `c031ed3`), halaman admin/middleware/PATCH Campaign belum. Sebagian. Tiket `08` sendiri mencatat detektor guard buta terhadap `role !== "ADMIN"` (`08-roles-contract.md:17`), cocok dengan temuan di ADR 0005.
  - `volunteer-trip/issues/01`–`05`: seluruhnya ada di git log (`7ef1b98` … `7df1178`) dan di kode; semua masih `ready-for-agent`. `06` sebagian (riwayat dan penyelesaian Batch ada, sertifikat tidak).
- **Koreksi (`87cce13`):** versi `450ede5` laporan ini menyebut tiket `02-lifecycle-expand`, `04-lifecycle-migrate-ui`, `05-lifecycle-contract` tanpa baris `Status:`. Itu salah: ketiganya punya `**Status:** ready-for-agent` di baris 7 (grep saya waktu itu menangkap baris "What to build" yang memuat kata "Statuses"). Temuan kodenya tetap: `02` selesai (enum + backfill), `04` dan `05` belum (katalog dan antrean masih membaca kolom string, `prisma/schema.prisma:153`), jadi `02` adalah satu lagi tiket selesai berstatus `ready-for-agent`.
- **Sejak `450ede5`:** tidak ada baris `Status:` yang berubah di `.scratch/**/issues/`. C1 dan C2 diperbaiki tanpa tiket. `.scratch/` di-*gitignore* (`.gitignore:53`), jadi riwayat status tiket tidak bisa diaudit lewat git. `docs/agents/triage-labels.md` (baru di `63d954f`) mewajibkan `done` setelah merge ke `main`; aturan itu belum diterapkan pada tiket yang sudah selesai.
- Tidak ada tiket berstatus `done` yang dibantah kode (enam tiket `ledger-line-visual-refresh` yang `done` bersifat visual dan tidak saya verifikasi satu per satu).
- **Urutan terbalik:** Fase 3 (Volunteer, ±6 tiket, lengkap dengan refund dan payout) dibangun sebelum pondasi Fase 0–1 (Kind, VR, mailer, Platform Fee). Bila Kind/Collecting Entity nanti mengubah lapisan uang (ADR 0010 menyatakan entri buku besar harus membawa Collecting Entity), kode Trip ikut harus diubah.
- **Langkah:** sinkronkan baris Status sebelum sesi perencanaan berikutnya; `docs/agents/issue-tracker.md` memakai kosakata `ready-for-agent`/`done`, jadi tambahkan status antara bila memang dibutuhkan.

### C16. Keputusan terbuka dipaku di kode — Rendah
- Ambang Refund Trip Fee 14/3 hari (`src/lib/volunteer/refunds.ts`) dan jendela hold 30 menit (`…/registrations/route.ts:11`) dipilih saat implementasi, padahal PRD §13 menandainya terbuka "sebelum Volunteer Trip pertama menerima Trip Fee nyata". Komentar kode mengakuinya. Perlu keputusan pemilik produk sebelum Trip dibuka.

### C17. Upload publik — Sedang (laten)
- `src/app/api/upload/route.ts:7-8` menyimpan ke `public/uploads`, dilayani tanpa kontrol akses. Hari ini hanya gambar; bila dipakai ulang untuk dokumen FFI-04 (KTP, akta), dokumen identitas akan terbuka publik.

### C18. Volunteer tidak bisa dicapai dari navigasi mana pun — Sedang
- **Sumber:** Dokumen Konsep baris 26, 34 (menu utama); PRD §3 baris 36 (menu pendukung sejak 19 Sep).
- **Bukti:** commit `8eb7dcd` membuang tile Volunteer "karena Volunteer pindah ke menu pendukung", tetapi `src/components/layout/Footer.tsx:19-36` dan `DesktopHeader.tsx:67-89` tidak memuat Volunteer, dan `src/app/` tidak punya halaman Volunteer. API-nya lengkap (`src/app/api/volunteer-trips/**`).
- **Dampak:** fitur Fase 3 yang sudah dibangun, termasuk jalur uang Trip Fee (C5), tidak punya pintu masuk bagi pengguna. Setengah keputusan PRD dijalankan (keluar dari menu utama), setengahnya tidak (masuk menu pendukung).
- **Langkah:** tambahkan Volunteer ke menu pendukung bersamaan dengan halaman katalog, setelah C5 ditutup. Tidak ada tiket UI Volunteer di `.scratch/volunteer-trip/issues/`.

### C19. Elemen kepercayaan homepage tidak bisa ditepati — Tinggi
- **Sumber:** Dokumen Konsep baris 89 ("Verified programs • Transparent reporting • Measurable impact"); PRD §1 baris 14; prinsip UX Dokumen Konsep baris 15.
- **Bukti:** di `450ede5`, "Verified" berasal dari swa-verifikasi (C2) dan Campaign bisa aktif tanpa Verifier (C1). Di `87cce13` lencana dihapus dan Campaign hanya aktif lewat moderasi, sehingga tidak ada lagi klaim palsu, tetapi juga tidak ada elemen "Verified programs" sama sekali; moderasi belum punya checklist maupun Verification Request. "Transparent reporting" tidak punya Usage Report, Receipt, maupun halaman Impact. "Measurable impact" tidak punya angka penerima manfaat (PRD #22, #92).
- **Dampak:** janji yang ditampilkan ke Donor lebih kuat daripada yang dijamin sistem; ini risiko reputasi dan bisa dianggap menyesatkan bila ada Campaign bermasalah.
- **Langkah:** jangan tampilkan ketiga elemen kepercayaan ini di homepage sebelum sisa C2 ditutup (identitas diperiksa Verifier dan tercatat) dan minimal Receipt + Usage Report ada. Tercakup di top-10 #10.

### C20. Tidak ada jalan sah ke COMPLETED dan tidak ada alat Suspension bagi Admin — Sedang (efek samping perbaikan C1)
- **Sumber:** PRD §8 ("Completed ditetapkan Fundraiser atau Admin dan membutuhkan minimal satu Campaign Update"), FFI-07b (Admin memutuskan Suspension, dicabut Admin lain), ADR 0004.
- **Bukti:** sebelum `b44f803`, PATCH (`450ede5` `src/app/api/campaigns/[slug]/route.ts:135-146`) adalah satu-satunya jalan API bagi pemilik atau ADMIN untuk menulis `status`. Kini `editCampaignSchema` tidak memuat status (`src/app/api/campaigns/[slug]/route.ts:14-19`), dan penulis status Campaign yang tersisa hanya moderasi Verifier (`src/app/api/moderasi/campaigns/[id]/route.ts:7-14, 52-55`: approve/reject/suspend) dan auto-complete webhook (`src/app/api/webhooks/[provider]/route.ts:342-360`). Komentar dan tes baru menyebut target/tenggat "change through a Verification Request or an Admin" (`route.ts:9-12`, `route.test.ts:423`), padahal kedua jalan itu tidak ada. Kolom `isUrgent` kini tidak punya penulis sama sekali di `src/` selain seed.
- **Dampak:** Campaign yang tidak mencapai target tidak bisa pernah COMPLETED; yang mencapai target otomatis COMPLETED tanpa Campaign Update (C3). Admin yang tidak memegang VERIFIER tidak punya cara menyuspensi. Pembenahan ini lebih aman daripada jalur lama yang tanpa syarat, dan tidak ada UI yang rusak, tetapi celah kapabilitasnya harus diketahui.
- **Langkah:** endpoint transisi status khusus (Completed oleh Fundraiser/Admin dengan syarat Campaign Update; Suspension/pencabutan oleh Admin dengan alasan), berpredikat status; bagian dari tiket 30, dikerjakan bersama perbaikan C3.

---

## 7. Temuan lintas-sektor

### 7.1 Tes dan typecheck
- **Di `87cce13`:** `DATABASE_URL=postgresql://nobody:nobody@127.0.0.1:1/none npx vitest run --reporter=dot` dijalankan dua kali. Jalan 1: **142 file, 1468 tes lulus**, 89,6 detik, tetapi **exit 1** karena Vitest menangkap 2 *unhandled error* (`ReferenceError: window is not defined` dan `Error: Should not already be working.` dari react-dom) yang "originated in `src/components/home/QuickActionTiles.test.tsx`". Jalan 2: 142 file, 1468 tes lulus, **exit 0**. File itu sendiri lulus 3/3 saat dijalankan terpisah dan tidak diubah sejak baseline, jadi ini tes *flaky* (render konkuren React yang masih berjalan saat jsdom dibongkar), bukan regresi dari C1/C2. Tetap layak diperbaiki karena bisa memerahkan CI secara acak.
- **Di `87cce13`:** `npx tsc --noEmit` → **86 error** (85 di file tes, 1 di `.next/types/app/api/upload/route.ts`). Perubahan dari 87: `api-validation.property.test.ts` 12 → 8 (blok swa-verifikasi dihapus), `src/app/api/campaigns/[slug]/route.test.ts` 13 → 16 (tes C1 baru memakai objek sesi mock tanpa `assignments`, pola yang sama dengan tiket 43). Tidak ada error baru di kode produksi.
- **Di `450ede5` (riwayat):** 139 file, 1482 tes lulus, exit 0; `tsc` 87 error. Selisih 14 tes berasal dari tes swa-verifikasi yang sengaja dihapus (VerificationDialog, VerificationBadge, Property 5) dikurangi tes baru untuk C1/C2.
- Tidak ada tes yang membutuhkan DB hidup (semua memock `@/lib/prisma`).
- `next.config.mjs` memasang `typescript.ignoreBuildErrors: true` dan `eslint.ignoreDuringBuilds: true`: typecheck dan lint bukan gerbang build. Juga `images.remotePatterns` `hostname: '**'` (gambar dari host mana pun).
- Tidak ada CI config di repo (tidak ditemukan `.github/workflows`), jadi "CI green" pada tiket tidak punya padanan otomatis yang bisa saya periksa.
- E2E Playwright (`tests/e2e/main-flows.spec.ts`) tidak dijalankan sesuai batasan tugas.
- Cakupan tes kuat di lapisan uang (`src/lib/money/*.test.ts`, webhook, payments). Otorisasi mutasi Campaign kini punya tes negatif (C1, `src/app/api/campaigns/[slug]/route.test.ts:352-446`); DELETE Campaign (C11) belum. Dua tes masih mengunci pelanggaran ADR 0004.

### 7.2 UI palsu atau mati
- Tombol "Hapus" admin selalu 404 (C11).
- "Bayar Zakat" membuang kategori dan nominal (C7).
- Tab "Pencairan Dana" di halaman Campaign (`src/components/campaign/CampaignDetail.tsx:80, 256`) selalu kosong karena Payout tidak bisa COMPLETED.
- `/moderasi/reports` placeholder "segera hadir" (`src/app/moderasi/reports/page.tsx:22-24`) padahal alur Suspension PRD bergantung pada laporan Verifier.
- "Saldo Kantong Donasi" masih tampil (`src/app/akun/page.tsx:110`), disengaja dan dijelaskan di `src/lib/wallet.ts`.
- Salinan yang masih menjanjikan swa-verifikasi setelah `87cce13`: `src/app/(static)/help/page.tsx:48-56` ("biasanya selesai secara instan"), `src/app/(static)/faq/faq-accordion.tsx:14`, `src/app/(static)/terms/page.tsx:56`, dan tombol "Verifikasi Sekarang" di `src/app/akun/kampanye-saya/page.tsx:125-131` (tautannya ke `/akun` tetap berfungsi, kini menampilkan "Hubungi Admin"). Ajakan "Hubungi Admin" mengarah ke `/contact`, yang hanya berisi tautan email dan WhatsApp statis (`src/app/(static)/contact/page.tsx:29, 62`).
- Tile CSR/Wakaf/Hibah ditandai jujur sebagai `comingSoon` (`src/lib/home/quickActionTiles.ts:17-35`). Ini bukan UI palsu.
- `notifyCampaignUpdate` dan `notifyPayout` adalah kode mati (`src/lib/notifications.ts:77, 116`).
- Panel Admin tidak punya UI untuk Payout, Refund, rekonsiliasi, maupun penugasan; semuanya hanya API (`src/app/admin/layout.tsx:33-41` hanya Dashboard, Pengguna, Kampanye).

### 7.3 Dokumen basi
- **`CLAUDE.md` (ditutup di `63d954f`):** di `450ede5` masih memerintahkan alur `/specflow:*` yang sudah dilepas (commit `a551aed`). Kini `CLAUDE.md:25-40` memakai skill `mattpocock-skills` saja dan `.claude/settings.json` hanya mengaktifkan plugin itu; setiap skill yang dirujuk (`grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `tdd`, `code-review`, `diagnosing-bugs`, `triage`, `improve-codebase-architecture`) ada di cache plugin lokal. `docs/agents/issue-tracker.md:45` dan `CLAUDE.md:27` masih menyebut specflow, tetapi hanya sebagai riwayat. Temuan ditutup.
- `docs/integrasi-sumopod.md` tabel pemetaan menyebut `payment_id` → `Payment.providerRef`, sedangkan kode sengaja memakai `order_id` (`src/lib/payments/sumopod-provider.ts:138-146`, dengan alasan). Dokumen yang sama menyatakan adapter "harus memakai `paid_at`… dan menyimpan `settled_at`", yang belum dilakukan (C9).
- ADR 0006 konsekuensi kedua ("webhook memaku Provider Fee nol") sudah tidak berlaku: `route.ts:242` membaca fee dari payload.
- Komentar skema `prisma/schema.prisma:66-70` ("Role hierarchy still governs access until tickets 07-08") sebagian basi; komentar `ledger.ts:240-256` ("NOT YET SURFACED ANYWHERE") basi karena Trip payouts GET memakai saldo escrow.
- Sisa identitas Kitabisa: `package.json:2` `kitabisa-clone`, akun seed `@kitabisa.com`, komentar `src/app/page.tsx:183, 197`.
- ADR 0002 dan 0014 sendiri konsisten satu sama lain (0002 diberi catatan pembaruan).

---

## 8. Metode dan batasan

**Yang dibaca penuh:** Dokumen Konsep Platform YIEM (`/home/ubuntu/.claude/uploads/6ca70760-51ea-4df9-9b0f-2361044d218c/086e73c6-fund_for_indonesia_platform_concept.md`, 89 baris), `docs/PRD-fund-for-indonesia.md` (426 baris), semua ADR 0001–0014, `CONTEXT.md`, `docs/integrasi-sumopod.md`, `prisma/schema.prisma`, `src/lib/money/{ledger,escrow,payouts,refunds}.ts`, `src/lib/payments/{types,index,sumopod-provider}.ts`, `src/lib/{donations,campaign-lifecycle,withAssignmentCheck,withRoleCheck,roles}.ts`, `src/middleware.ts`, `src/app/api/webhooks/[provider]/route.ts`, `src/app/api/donations/route.ts`, `src/app/api/campaigns/route.ts`, `src/app/api/campaigns/[slug]/{route,payouts/route,refunds/route,updates/route,donations/route,disbursements/route}.ts`, `src/app/api/moderasi/campaigns/[id]/route.ts`, `src/app/api/user/verify/route.ts`, `src/app/api/zakat/campaigns/route.ts`, `src/app/admin/{layout,page}.tsx`, `DeleteCampaignButton.tsx`, `deploy.sh`, `next.config.mjs`, `vitest.config.ts`, `playwright.config.ts`.

**Yang dibaca sebagian / lewat grep:** route volunteer-trip, registrasi, laporan rekonsiliasi, halaman donate/zakat/akun/moderasi, komponen layout, `prisma/seed.ts`, migrasi `mark_demo_campaigns`, `src/lib/auth.ts`, tiket di `.scratch/**/issues/` (baris Status dan kriteria terima tiket 01, 07, 08), `git log` (141 commit).

**Yang dijalankan:** `npx vitest run` (di `450ede5` sekali; di `87cce13` dua kali penuh plus 3 kali `QuickActionTiles.test.tsx` terpisah, detail di 7.1), `npx tsc --noEmit` (87 error di `450ede5`, 86 di `87cce13`), serta grep/`git log`/`git show` baca-saja. Tidak ada migrasi, seed, e2e, maupun panggilan ke penyedia pembayaran. `.env` tidak dibuka.

**Yang tidak bisa diverifikasi:**
- Perilaku produksi nyata: nilai env yang terpasang (`NEXT_PUBLIC_DONATIONS_ENABLED`, `PAYMENT_PROVIDER`), apakah Sumopod produksi sudah aktif, apakah akun merchant benar-benar tidak dibagi dengan Makam (ADR 0011).
- Isi basis data produksi (jumlah Campaign Demo, saldo `donationBalance`, apakah ada BankAccount yang diisi manual).
- Performa (LCP) dan konkurensi 500 donasi.
- Apakah operator memakai `deploy.sh` atau jalur deploy lain.
- Kebenaran visual tiket `ledger-line-visual-refresh` berstatus `done`.
- Adapter mock (`src/lib/payments/mock-provider.ts`) tidak saya baca baris per baris; saya mengandalkan komentar di `types.ts` dan `index.ts`.

**Pembaruan ke `87cce13`:** `git log 450ede5..HEAD`, `git diff --stat` dan diff penuh untuk seluruh file `src/` yang berubah (kode produksi dan tes), `git diff` untuk `.gitignore`, `CLAUDE.md`, `docs/agents/*`; grep penulis `campaign.update`, `isVerified`, `isUrgent`, `user/verify`, dan salinan "verifikasi identitas"; baris `Status:` semua tiket; daftar skill di cache plugin `mattpocock-skills`. Tidak bisa diverifikasi: berapa pengguna di DB yang memegang `CAMPAIGN_CREATOR`/`isVerified` hasil swa-verifikasi (sisa C2 (a)). Salinan laporan versi `450ede5` disimpan di scratchpad sesi, bukan di repo.

**Tambahan untuk Dokumen Konsep:** `git show 8eb7dcd` (pesan dan diff `src/lib/home/quickActionTiles.ts`), `CLAUDE.md:3`, slide banner `src/app/page.tsx:31-46`, grep Volunteer/Stories/Impact/Mitra di `src/components/layout/` dan `src/app/page.tsx` (tidak ada hasil untuk Volunteer). Tidak bisa diverifikasi: apakah Dokumen Konsep identik dengan deck yang dirujuk PRD baris 4, dan apakah YIEM menyetujui perubahan PRD di luar deck (X2, X3).

**Cara menghitung status:** satu baris matriks = satu klaim yang bisa dicek di kode. Kriteria terima PRD yang berisi banyak klausa dipecah bila klausanya punya status berbeda (misalnya FFI-01 menjadi 11 baris). Butir yang sama tidak dihitung dua kali di dalam satu matriks. Hitungan ADR dan hitungan Dokumen Konsep terpisah dari hitungan PRD; butir Dokumen Konsep yang juga diatur PRD dihitung di kedua matriks, karena tiap matriks mengukur kepatuhan terhadap sumbernya sendiri. Langkah alur Dokumen Konsep dihitung satu per langkah.
