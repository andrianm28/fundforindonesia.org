# Ronde keputusan C: C1 sampai C23 untuk dijawab owner sekaligus

Tanggal: 2026-10-04. Sumber: Track C di `.scratch/percepatan-full-rilis/plan.md` (rekomendasi di depan). Dokumen ini semula mengumpulkan pertanyaan supaya owner bisa menjawab semuanya dalam satu pesan; owner menjawab pada 2026-10-04 (relay sesi VPS) dan tiap jawaban dicatat di baris "Jawaban owner" butirnya.

**Cara menjawab:** tulis `ya` untuk mengikuti rekomendasi, atau tulis jawaban lain pada baris "Jawaban owner" tiap butir. Menurut `docs/agents/issue-tracker.md`, bila owner menjawab beberapa pertanyaan dalam satu pesan, tiap jawaban dicatat sebagai tiketnya sendiri dan commit-nya menyebut bahwa semuanya mendarat bersama.

**Gerbang waktu (dari rencana):** C1 sampai C6 harus terjawab sebelum G0 selesai. Sisanya sebelum gelombang yang membutuhkannya.

**Catatan rujukan:** nomor baris diperiksa terhadap berkas pada 2026-10-04, sesudah amandemen `CONTEXT.md` dan PRD di PR yang sama. Rencana menyebut `CONTEXT.md:291` untuk C1; amandemen itu menambah satu baris, jadi teks Soft Launch kini ada di `CONTEXT.md:292` (judul istilah di baris 291).

---

## Ringkasan jawaban (2026-10-04)

Owner menjawab C1 sampai C22 dan E1 sampai E9 dalam satu pesan; semuanya mendarat bersama dalam satu commit, sesuai pengecualian di `docs/agents/issue-tracker.md`.

**Menyimpang dari rekomendasi:**

| Butir | Rekomendasi | Jawaban owner | Dampak |
|---|---|---|---|
| C3 | 5% donation, 0 lainnya, ambang Rp50.000 | Tidak ada angka awal sekarang; Admin mengisi lewat panel di A5.3 | `plan.md` A5.3; tiket 88 (ada di PR #228, belum merge; dicatat di plan dan peta saja) |
| C5 | Bucket S3-compatible + signed URL | Volume lokal di host, privat, hanya lewat route ber-ACL | Tiket 64 lengkap; backup volume oleh sesi VPS saat D-1 dideploy; baris bucket di A3 dicabut |
| C13 | Tombol Google disembunyikan sampai nanti | Google OAuth disiapkan sebelum M1; tombol tersembunyi otomatis sampai env diisi | Langkah baru di A3 `plan.md` |
| C18 | Escrow 7 hari sebagai konstanta; amandemen FFI-17 | Setelan Admin; FFI-17 tetap | Tiket baru 90; catatan di PRD |
| C19 | Flip manual `SHOW_DEMO_CAMPAIGNS=false` | Otomatis; flag tetap penimpa manual | Tiket baru 91; langkah A6 tidak lagi perlu flip |
| E2 | Tunggu counsel sebelum kode pengalihan | Dibangun setelah counsel; pelacakan pengingat boleh duluan | Tiket E2 tetap `needs-info` |
| E6 | (tanpa rekomendasi) | Grilling terpisah | Tiket E6 tetap `needs-info` |
| E7 | next-intl, slug tetap Indonesia | next-intl, slug diterjemahkan | ADR i18n: peta pathname per bahasa, canonical, hreflang |

Butir lain mengikuti rekomendasi atau (E1, E4, E5, E8, E9) tidak punya rekomendasi tertulis. Fakta merge dan deploy yang menyertai pesan itu dicatat di `peta-tiket.md`.

---

## C1. Uang sebelum gerbang F2

- **Pertanyaan:** `CONTEXT.md:292` (istilah **Soft Launch**) melarang menerima uang publik sebelum gerbang Fase 2 lolos. Bolehkah ada gladi tertutup dengan uang nyata sebelum itu?
- **Rekomendasi:** Izinkan **gladi tertutup** setelah M-a dan A-1 merge: satu Campaign YIEM, tanpa promosi, nominal kecil. Soft Launch tetap berarti promosi publik, dan baru setelah M2. Amandemen `CONTEXT.md` (entri Soft Launch) menyebut perbedaannya.
- **Kalau ditolak:** M1 (donasi nyata pertama) tidak bisa dilakukan sebelum M2. Padahal M2 butuh dana nyata yang sudah lewat escrow 7 hari, jadi urutannya macet: M2 tidak bisa dibuktikan tanpa uang nyata, dan uang nyata tidak boleh ada sebelum M2. Pilihan lain yang tersisa hanya membuktikan semuanya di staging sandbox, yang tidak membuktikan penyedia nyata.
- **Rujukan:** `CONTEXT.md:291-292`; `plan.md` bagian "Definisi selesai dan milestone".
- **Jawaban owner:** 2026-10-04: **diizinkan**, sesuai rekomendasi. Gladi tertutup dengan uang nyata boleh sebelum gerbang F2; entri Soft Launch di `CONTEXT.md` diamandemen.

## C2. "Dua penyedia terekonsiliasi" pindah dari gerbang M2 ke M3

- **Pertanyaan:** PRD §11 (`docs/PRD-fund-for-indonesia.md:327`, baris Fase 2) menuntut "Payment dari dua penyedia terekonsiliasi" sebagai syarat lolos Fase 2. Xendit belum mulai. Pindahkan syarat itu ke M3?
- **Rekomendasi:** Ya. Soft Launch cukup dengan Sumopod. Syarat dua penyedia tetap wajib untuk Rilis 1 penuh (M3).
- **Kalau ditolak:** Soft Launch tertunda sampai Xendit lolos KYB dan adapter M-c selesai, yang bergantung pada vendor dan paling mungkin menentukan tanggal seluruh rencana.
- **Rujukan:** PRD §11 baris Fase 2 (`:327`); `plan.md` lajur X; `.scratch/rilis-1-benda/issues/18-second-payment-provider.md`.
- **Jawaban owner:** 2026-10-04: **pindah ke M3**, sesuai rekomendasi. Soft Launch cukup dengan Sumopod; syarat dua penyedia tetap wajib untuk Rilis 1 penuh.

## C3. Platform Fee

- **Pertanyaan:** Nilai awal fee saat rilis (PRD menyebut "usulan 5 persen untuk `donation` dan nol untuk Category bencana", `docs/PRD-fund-for-indonesia.md:310`). Berapa nilainya?
- **Rekomendasi:** 5% untuk `donation`; 0 untuk bencana, zakat, wakaf, dan hibah; tanpa fee di bawah Rp50.000 (ambang sudah ada di PRD FFI-01, `:122`, dan di `platform-fee-config.ts`).
- **Kalau ditolak:** Admin tidak punya nilai awal untuk dimasukkan di A5.3. Kode mengizinkan nilai berapa pun lewat panel Admin dan fee dibekukan per Payment, jadi mengubahnya kemudian tidak merusak data lama, tetapi nilai yang salah di Campaign pertama tidak bisa ditarik untuk Donation yang sudah masuk.
- **Rujukan:** PRD `:310-313`; `src/lib/money/platform-fee-config.ts`; `CONTEXT.md:186`.
- **Jawaban owner:** 2026-10-04: **MENYIMPANG dari rekomendasi.** Tidak ada nilai awal yang ditetapkan sekarang. Nilai diatur Admin di panel (A-1, tiket 88) dan diisi pada langkah A5.3. Rekomendasi 5%/0/ambang Rp50.000 tidak diambil.

## C4. Dokumen wajib

- **Pertanyaan:** Kapan dokumen Campaign (PRD §7.1) wajib diunggah di produk?
- **Rekomendasi:** Wajib sebelum M2. Untuk M1, dokumen YIEM diperiksa di luar produk dan Verifier mencatatnya.
- **Kalau ditolak:** Bila wajib sejak M1, tiket D-1 (penyimpanan dokumen privat, XL, skema) harus selesai sebelum donasi pertama dan jalur kritis M1 bertambah sekitar satu minggu builder. Bila tidak wajib sampai Rilis 1 penuh, Verifier memeriksa dokumen tanpa jejak di produk, yang melemahkan audit.
- **Rujukan:** PRD §7.1 (`docs/PRD-fund-for-indonesia.md:147`); `.scratch/rilis-1-benda/issues/03-documents.md`.
- **Jawaban owner:** 2026-10-04: **wajib sebelum M2**, sesuai rekomendasi.

## C5. Penyimpanan dokumen

- **Pertanyaan:** Di mana dokumen Campaign disimpan?
- **Rekomendasi:** Bucket object storage yang kompatibel S3 dengan signed URL. Owner mengonfirmasi bahwa bucket itu terisolasi dari object storage milik stack lain di host.
- **Kalau ditolak:** Alternatifnya disk lokal atau volume uploads, yang menaikkan risiko (disk host sudah 81-84%, dan dokumen berisi KTP). Atau object storage yang berbagi dengan stack lain, yang mencampur akses.
- **Rujukan:** `.scratch/rilis-1-benda/issues/03-documents.md`; `plan.md` A3 dan tiket D-1.
- **Jawaban owner:** 2026-10-04: **MENYIMPANG dari rekomendasi (bukan S3).** Volume lokal di host. Untuk D-1 (tiket 64): volume privat terpisah (bukan `public/uploads`), disajikan hanya lewat route ber-ACL (Verifier, Fundraiser pemilik, Admin), tidak lewat nginx atau static. Sesi VPS memasukkan volume itu ke backup malam dan offsite terenkripsi saat D-1 dideploy.

## C6. Reveal rekening tujuan Payout

- **Pertanyaan:** Admin tidak bisa melihat nomor rekening tujuan Payout: `src/app/admin/payouts/[id]/page.tsx:70` hanya memilih `bankCode` dan `accountName`. Siapa boleh melihat nomornya, dan bagaimana dicatat?
- **Rekomendasi:** Hanya Admin penyelesai (yang mentransfer), dengan tombol reveal yang tercatat di tabel audit.
- **Kalau ditolak:** Bila semua Admin boleh melihat, permukaan data sensitif membesar dan audit kurang tajam. Bila tidak ada reveal, Payout manual mustahil tanpa psql, yang melanggar syarat "tanpa akses basis data" gerbang F2.
- **Rujukan:** `src/app/admin/payouts/[id]/page.tsx:70`; `.scratch/rilis-1-benda/issues/12-decrypting-a-bank-account-at-payout.md`; ADR 0012.
- **Jawaban owner:** 2026-10-04: **hanya Admin penyelesai, tercatat di tabel audit**, sesuai rekomendasi.

## C7. Kind saat peluncuran

- **Pertanyaan:** Kind Campaign apa yang dibuka saat peluncuran?
- **Rekomendasi:** `donation` saja, sampai ada mitra zakat (LAZ/BAZNAS) dan wakaf (nazhir BWI) serta review syariah untuk hibah.
- **Kalau ditolak:** Membuka zakat, wakaf, atau hibah lebih awal memerlukan Kind Authorisation dan keputusan legal yang belum ada (A4); risikonya bukan teknis melainkan kepatuhan.
- **Rujukan:** `CONTEXT.md:17-25` (Kind, Kind Authorisation); ADR 0013; PRD §10 (`docs/PRD-fund-for-indonesia.md:311-313`).
- **Jawaban owner:** 2026-10-04: **`donation` saja** saat peluncuran, sesuai rekomendasi.

## C8. Lokasi dan penerima manfaat

- **Pertanyaan:** Bentuk data lokasi dan penerima manfaat pada Campaign (tiket F6, skema).
- **Rekomendasi:** Provinsi dari daftar statis, kabupaten/kota teks bebas, penerima manfaat plus jumlah opsional.
- **Kalau ditolak:** Daftar penuh provinsi sampai kecamatan menambah data referensi dan pemeliharaan; teks bebas penuh membuat pencarian dan filter lokasi tidak konsisten.
- **Rujukan:** PRD §6 (`docs/PRD-fund-for-indonesia.md:79`) dan §11 baris Fase 1.
- **Jawaban owner:** 2026-10-04: **provinsi dari daftar statis, kabupaten/kota teks, penerima manfaat dan jumlah opsional**, sesuai rekomendasi.

## C9. Kategori wakaf

- **Pertanyaan:** Kategori wakaf tunai.
- **Rekomendasi:** Masjid, sekolah, fasilitas kesehatan, fasilitas umum (sama dengan PRD §6).
- **Kalau ditolak:** Kategori lain mengubah data checklist dan Akad Wakaf. Hanya relevan setelah wakaf dibuka (lihat C7).
- **Rujukan:** PRD `docs/PRD-fund-for-indonesia.md:82`.
- **Jawaban owner:** 2026-10-04: **empat kategori PRD** (masjid, sekolah, fasilitas kesehatan, fasilitas umum), sesuai rekomendasi.

## C10. Suspension tanpa Flag Verifier

- **Pertanyaan:** Boleh Admin menangguhkan Campaign tanpa Flag dari Verifier?
- **Rekomendasi:** Boleh, asal alasannya tercatat. Catatan: `CONTEXT.md:126` (istilah Suspension) dan ADR 0015 sudah menyatakan "tanpa Flag pun boleh selama alasannya tercatat", jadi butir ini kemungkinan hanya konfirmasi, bukan keputusan baru.
- **Kalau ditolak:** `CONTEXT.md` dan ADR 0015 harus diubah, dan Admin tidak bisa bertindak cepat atas laporan yang belum sempat di-Flag.
- **Rujukan:** `CONTEXT.md:125-126`; ADR 0015; `src/lib/campaign-lifecycle.ts` (suspensi menyelesaikan Flag yang terbuka, bukan mensyaratkannya, sekitar baris 1493-1522).
- **Jawaban owner:** 2026-10-04: **boleh, alasan dicatat**, sesuai rekomendasi (konfirmasi atas `CONTEXT.md` dan ADR 0015).

## C11. Settlement terlambat

- **Pertanyaan:** Donasi yang settle setelah Payment kedaluwarsa (ADR 0021 menyatakan tetap dibukukan) dan kini tak punya tempat: otomatis di-Refund, diusulkan sebagai Refund, atau dibiarkan?
- **Rekomendasi:** Diusulkan sebagai Refund kepada Admin, tidak otomatis (tiket M-d). Untuk Trip Fee, perilaku yang ada tetap (Refund otomatis, `rilis-1-benda/issues/40` dan `43`).
- **Kalau ditolak:** Bila otomatis, Refund uang nyata terjadi tanpa mata manusia. Bila dibiarkan, uang Donor tertahan tanpa penjelasan dan muncul di antrean rekonsiliasi.
- **Rujukan:** ADR 0021; `.scratch/rilis-1-benda/issues/40-trip-fee-settles-after-hold-expired-auto-refund.md`; `.../43-sweep-for-refunds-stuck-after-late-settlement.md`; `docs/runbooks/payment-reconciliation.md`.
- **Jawaban owner:** 2026-10-04: **diusulkan sebagai Refund kepada Admin**, tidak otomatis, sesuai rekomendasi.

## C12. Batas Campaign Active dan durasi

- **Pertanyaan:** Aturan maksimum tiga Campaign Active per Fundraiser dan durasi maksimum.
- **Rekomendasi:** Batas tiga dicabut setelah Usage Report pertama Fundraiser itu; durasi maksimum 12 bulan, wakaf dikecualikan (PRD FFI-04 sudah memuat 12 bulan dan pengecualian wakaf; yang baru adalah pencabutan batas tiga).
- **Kalau ditolak:** Batas tiga tetap permanen: Fundraiser yang sudah terbukti jujur tidak bisa berkembang. Mencabutnya tanpa syarat Usage Report menghilangkan sinyal kepercayaan.
- **Rujukan:** `src/lib/campaign-lifecycle.ts:607-650` (`requireWithinActiveCampaignLimit`); PRD FFI-04 (`docs/PRD-fund-for-indonesia.md:125`).
- **Jawaban owner:** 2026-10-04: **batas tiga Active dicabut setelah Usage Report pertama; durasi 12 bulan, wakaf dikecualikan**, sesuai rekomendasi.

## C13. Tombol Google

- **Pertanyaan:** Tombol masuk dengan Google bila Google OAuth belum dikonfigurasi.
- **Rekomendasi:** Disembunyikan sampai dikonfigurasi (tiket H-2). Saat ini `src/lib/auth.ts:24-25` membaca `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` tanpa pengaman, dan halaman login `src/app/(auth)/login/page.tsx` menampilkan tombolnya.
- **Kalau ditolak:** Tombol yang tidak berfungsi tampil di produksi, atau Google OAuth harus disiapkan sebelum M1 (menambah langkah vendor).
- **Rujukan:** ADR 0022 (Google sign-in tidak memverifikasi email); `src/lib/auth.ts:24`; `plan.md` H-2.
- **Jawaban owner:** 2026-10-04: **MENYIMPANG dari rekomendasi.** Google OAuth **disiapkan sebelum M1**, bukan disembunyikan sampai nanti. Tombol tetap tersembunyi otomatis sampai env diisi (#223). Langkah vendor baru di A3 `plan.md`; redirect URI di apex; akun Google milik FFI.

## C14. Transfer hibah

- **Pertanyaan:** Batas kategori pada Campaign Transfer untuk hibah.
- **Rekomendasi:** Tanpa batas kategori sampai review syariah. Kode sekarang: hibah hanya ke hibah, lintas Kind ditolak (`src/lib/money/campaign-transfers.ts:27-36`, `:100`).
- **Kalau ditolak:** Bila ingin pembatasan kategori sekarang, perlu aturan yang belum didefinisikan dan tiket tambahan.
- **Rujukan:** ADR 0015; `src/lib/money/campaign-transfers.ts:27-36, :100`; PRD `:202`.
- **Jawaban owner:** 2026-10-04: **transfer hibah tanpa batas kategori**, sesuai rekomendasi.

## C15. Rekap keuangan

- **Pertanyaan:** Bentuk rekap keuangan Admin (PRD §9; tiket A-6).
- **Rekomendasi:** Per periode, per Kind, per Campaign, plus ekspor CSV.
- **Kalau ditolak:** Definisi lain (misalnya per Program atau per penyedia) mengubah kueri dan CSV. Tanpa keputusan, tiket A-6 tidak bisa ditulis spesifik.
- **Rujukan:** PRD §9 dan FFI-17; `.scratch/rilis-1-benda/scorecard.md` ("Membuat rekap keuangan": "no code, and no definition anywhere").
- **Jawaban owner:** 2026-10-04: **rekap per periode x Kind x Campaign, plus ekspor CSV**, sesuai rekomendasi.

## C16. Hold kursi Volunteer

- **Pertanyaan:** Batas hold kursi untuk mencegah penimbunan kursi (tiket V-1, review konkurensi).
- **Rekomendasi:** Maksimal 2 hold per akun, ditambah rate limit. Angka pasti ditulis di tiketnya dan sengaja tidak dipublikasikan di sini (menyamarkan angka anti-abuse).
- **Kalau ditolak:** Tanpa batas, satu akun bisa menimbun seluruh kuota Batch dan menutup pendaftar lain; batas terlalu ketat menghalangi pendaftar yang sah.
- **Rujukan:** `.scratch/rilis-1-benda/issues/50-seat-hoarding-without-limit.md` (status `needs-info`; menunggu PR #161 dan keputusan batas).
- **Jawaban owner:** 2026-10-04: **batas hold kursi per akun, ditambah rate limit**, sesuai rekomendasi. Angka-angkanya tersamar: tidak dicantumkan di repo publik, termasuk di tiket.

## C17. Email Volunteer

- **Pertanyaan:** Kapan email Volunteer (konfirmasi pendaftaran dan Refund Trip Fee) dibangun?
- **Rekomendasi:** Masuk M3 (tiket V-3), bukan sebelum.
- **Kalau ditolak:** Bila lebih awal, menambah pekerjaan di jalur sebelum M2. Bila ditiadakan, Volunteer tidak menerima konfirmasi apa pun di luar layar.
- **Rujukan:** `plan.md` tiket V-3; PRD §7 FFI-11.
- **Jawaban owner:** 2026-10-04: **email Volunteer di M3** (tiket V-3), sesuai rekomendasi.

## C18. Escrow 7 hari

- **Pertanyaan:** Apakah lama Escrow Hold tetap bisa diatur Admin (PRD FFI-17 menyebut "lama Escrow Hold" sebagai setelan Admin)?
- **Rekomendasi:** Jadikan 7 hari konstanta dan amandemen PRD FFI-17. Skema sekarang `escrowHoldDays Int @default(7)` (`prisma/schema.prisma:1436`) dan Payment menyalin nilainya saat dibuat.
- **Kalau ditolak:** Panel Admin untuk mengubah escrow harus dibangun dan diuji, dengan risiko mengubah perlindungan Donor tanpa review.
- **Rujukan:** PRD FFI-17 (`docs/PRD-fund-for-indonesia.md:144`); `prisma/schema.prisma:1436`; `.scratch/rilis-1-benda/issues/04-numbers-code-or-config.md`.
- **Jawaban owner:** 2026-10-04: **MENYIMPANG dari rekomendasi (bukan konstanta).** Lama Escrow Hold adalah **setelan Admin**. PRD FFI-17 tetap seperti ditulis. Tiket baru: `rilis-1-benda/issues/90-admin-escrow-hold-setting.md` (panel Escrow Hold di Admin; nilai disalin ke Payment saat dibuat, seperti `escrowHoldDays` sekarang; riwayat perubahan dengan aktor; kode uang, review independen; pertimbangkan per Category, bencana dipendekkan, sesuai PRD).

## C19. Demo Campaign

- **Pertanyaan:** Bagaimana Demo Campaign disembunyikan saat Campaign nyata pertama Active?
- **Rekomendasi:** Dengan flip manual: `SHOW_DEMO_CAMPAIGNS=false` pada langkah A6, bukan otomatis.
- **Kalau ditolak:** Otomatis menuntut kode dan pengujian tambahan; PRD §11 baris Fase 1 menyebut "saat Campaign nyata pertama Active", yang bisa dibaca otomatis.
- **Rujukan:** `CONTEXT.md:276` (Demo Campaign); `.scratch/prd-compliance-fase-0-2/issues/56-show-demo-campaigns-flag.md` (PR #215).
- **Jawaban owner:** 2026-10-04: **MENYIMPANG dari rekomendasi (otomatis, bukan flip manual).** Demo Campaign disembunyikan dari katalog dan Impact begitu ada Campaign nyata Active. `SHOW_DEMO_CAMPAIGNS` tetap sebagai penimpa manual. Tiket baru: `rilis-1-benda/issues/91-demo-campaigns-auto-hide.md`.

## C20. Receipt anonim

- **Pertanyaan:** Receipt untuk Donation anonim: tampilkan nama asli kepada pemegang token?
- **Rekomendasi:** Tetap menampilkan nama; hanya pemegang token Receipt (Donor sendiri) yang bisa melihatnya. Kode sekarang meneruskan `donation.donor?.name ?? donation.guestName` tanpa cabang `isAnonymous` (`src/app/receipt/[token]/page.tsx:57`, dicetak di `src/components/receipt/ReceiptView.tsx:80`), jadi ini mengesahkan perilaku yang ada.
- **Kalau ditolak:** Receipt harus menyembunyikan nama untuk Donation anonim, dan perlu diputuskan apa yang tercetak (misalnya "Donor anonim"), plus tes.
- **Rujukan:** `src/app/receipt/[token]/page.tsx:57`; `src/components/receipt/ReceiptView.tsx:80`; `.scratch/rilis-1-benda/scorecard.md` ("The leak").
- **Jawaban owner:** 2026-10-04: **Receipt anonim tetap menampilkan nama**, sesuai rekomendasi.

## C21. Perubahan Bank Account

- **Pertanyaan:** Apakah mengganti rekening bagian dari change request Campaign?
- **Rekomendasi:** Bukan. Rekening dipilih per Payout dan setiap rekening diverifikasi sendiri (ADR 0018).
- **Kalau ditolak:** Perlu jenis Verification Request baru yang mengaitkan Campaign dan rekening, dan Payout yang sedang berjalan harus diputuskan nasibnya.
- **Rujukan:** ADR 0018; `CONTEXT.md:133` (Verification Request); `CONTEXT.md` entri Bank Account.
- **Jawaban owner:** 2026-10-04: **rekening dipilih per Payout, bukan change request**, sesuai rekomendasi. PRD FFI-05 diamandemen (bagian rekening pada perubahan Campaign Active dicabut).

## C22. Disbursement API

- **Pertanyaan:** Apakah Payout otomatis lewat API penyedia dibangun untuk Rilis 1?
- **Rekomendasi:** Ditunda. Transfer manual dengan bukti tetap berlaku (ADR 0006).
- **Kalau ditolak:** Menambah pekerjaan besar di Sumopod dan Xendit (disbursement) dan risiko uang keluar otomatis; juga mengubah rencana syarat dua mata Admin.
- **Rujukan:** ADR 0006; ADR 0003; `docs/integrasi-sumopod.md` (Sumopod tanpa disbursement).
- **Jawaban owner:** 2026-10-04: **ditunda**, sesuai rekomendasi. Transfer manual dengan bukti tetap berlaku (ADR 0006).

---

## C23. Item perluasan (E1 sampai E9)

Ketujuh item perluasan Fase 3 masuk Rilis 1 (keputusan owner 2026-10-04, diamandemen di `CONTEXT.md` dan PRD §6 dan §11). Tiap item butuh grilling singkat sebelum dibuat tiketnya; pertanyaan di bawah adalah yang sudah ada di rencana. Relay kedua memulihkan daftar E1 sampai E8 (E5 = impor settlement otomatis, E8 = Asset Waqf Inquiry). Rencana tidak memuat pertanyaan C23 untuk E5; untuk E8 dan E9 pertanyaannya "sub-pertanyaan dari tiketnya".

### E1. Tautan pendek

- **Pertanyaan:** Domain atau prefix mana yang dipakai untuk tautan pendek?
- **Rekomendasi:** [rekomendasi tidak ada di rencana; owner menentukan domain dan prefix]
- **Kalau ditolak:** Tiket E1 tidak bisa mulai; Traffic Source per tautan di FFI-06 tetap memakai tautan panjang.
- **Rujukan:** PRD FFI-06 (`docs/PRD-fund-for-indonesia.md:127`); `.scratch/prd-audit/issues/12-campaign-share-not-wired.md`.
- **Jawaban owner:** 2026-10-04: **prefix di apex** (mis. `/s/<kode>`), tanpa domain terpisah. Rencana tidak punya rekomendasi; ini keputusan owner.

### E2. Pengalihan Dormant Balance (aturan 180 hari)

- **Pertanyaan:** Apa dasar legal aturan 180 hari tanpa Payout dan tanpa tanggapan atas tiga pengingat sebelum saldo dialihkan?
- **Rekomendasi:** Counsel legal memastikan dasarnya (bagian A4) sebelum kode pengalihan ditulis. Laporan 60 hari dan Campaign Transfer yang ada tetap berjalan; yang belum ada adalah pelacakan pengingat dan pengalihannya (`.scratch/prd-compliance-fase-0-2/issues/37-dormant-balance-report.md`, kotak 2).
- **Kalau ditolak:** Pengalihan tidak bisa dibangun dengan aman; saldo dormant tetap Campaign Balance biasa dan item perluasan ini tidak selesai di Rilis 1.
- **Rujukan:** `CONTEXT.md:247-248` (Dormant Balance); PRD §7.3; `src/lib/money/dormant-balances.ts`.
- **Jawaban owner:** 2026-10-04: **dibangun setelah counsel mengonfirmasi dasar legal**; pelacakan pengingat boleh dibangun lebih dulu. Menambah rekomendasi (yang hanya menunda seluruh kode pengalihan), jadi ditandai menyimpang. Tiket tetap menunggu counsel.

### E3. Refund yang diminta sendiri oleh Donor

- **Pertanyaan:** Jendela waktu, batas per Kind, dan pengamanan anti-abuse untuk Refund yang dimulai Donor.
- **Rekomendasi:** [rekomendasi angka tidak ada di rencana; angka anti-abuse sengaja tidak ditulis publik]. Prinsip: kode uang, wajib review independen sonnet.
- **Kalau ditolak:** Refund tetap hanya dimulai Admin; item perluasan ini tidak selesai dan PRD §7.2 tidak berubah.
- **Rujukan:** PRD §7.2 (`docs/PRD-fund-for-indonesia.md:158`); `CONTEXT.md` entri Refund; `src/lib/money/refunds.ts`.
- **Jawaban owner:** 2026-10-04: **hanya sebelum Payout, dengan jendela waktu, batas per Kind, dan Admin menyetujui.** Angka anti-abuse di tiket tersamar (tidak dicantumkan di repo publik).

### E4. Anggota tim untuk Fundraiser organisasi

- **Pertanyaan:** Peran apa yang dimiliki anggota, dan bolehkah anggota meminta Payout?
- **Rekomendasi:** Anggota **tidak** boleh meminta Payout; permintaan Payout tetap milik akun Fundraiser utama organisasi.
- **Kalau ditolak:** Bila anggota boleh meminta Payout, kode uang bertambah (aturan dua orang dan pemisahan tugas harus dihitung ulang) dan review independen jadi wajib lebih berat.
- **Rujukan:** `CONTEXT.md:106` (Partner Organisation: "anggota tim menyusul"); ADR 0005 (peran sebagai Assignment terpisah).
- **Jawaban owner:** 2026-10-04: **anggota tim TIDAK boleh meminta Payout**, sesuai rekomendasi.

### E5. Impor settlement otomatis

- **Pertanyaan:** Rencana tidak memuat pertanyaan C23 untuk E5; diajukan saat grilling singkat setelah M-c.
- **Prasyarat:** Setelah M-c (xendit-adapter), karena impor bergantung pada penyedia kedua. Ukuran M-L.
- **Rujukan:** `plan.md` Lajur X dan Lajur E; `.scratch/rilis-1-benda/issues/85-xendit-adapter.md`.
- **Jawaban owner:** 2026-10-04: **setelah M-c** (xendit-adapter, tiket 85).

### E6. Notifikasi WhatsApp

- **Pertanyaan:** Penyedia (BSP) mana dan berapa biayanya, dan model consent apa yang dipakai?
- **Rekomendasi:** [rekomendasi tidak ada di rencana]. Persetujuan WhatsApp harus sesuai UU PDP (A4) dan verifikasi Meta/WhatsApp Business dimulai hari 0 (A3).
- **Kalau ditolak:** WhatsApp tidak masuk Rilis 1 dan item perluasan ini tidak selesai; email transaksional tetap cukup untuk gerbang Fase 0 sampai 2.
- **Rujukan:** `plan.md` A3, A4, G5; PRD §6 daftar pengecualian (dengan amandemen 2026-10-04).
- **Jawaban owner:** 2026-10-04: **MENYIMPANG: grilling terpisah** (belum dijawab di ronde ini; penyedia/BSP, biaya, dan model consent diputuskan di sana).

### E7. Versi bahasa Inggris

- **Pertanyaan:** Pustaka dan aturan slug.
- **Rekomendasi:** `next-intl`; slug tetap Indonesia. Dikerjakan sendirian di G5 karena menyentuh semua halaman, dengan ADR kunci di G1.
- **Kalau ditolak:** Pustaka atau slug lain mengubah ADR i18n dan seluruh ekstraksi teks; i18n menyentuh semua halaman sehingga keputusan terlambat mahal. Saat ini belum ada pustaka i18n di `package.json`.
- **Rujukan:** PRD §9 baris Bahasa (`docs/PRD-fund-for-indonesia.md:303`); `.scratch/prd-audit/research/01-fase-0-1.md` (⚠️ 2).
- **Jawaban owner:** 2026-10-04: **MENYIMPANG dari rekomendasi (slug).** `next-intl` dengan **slug diterjemahkan** (bukan slug Indonesia untuk semua bahasa). ADR i18n harus mendefinisikan peta pathname per bahasa, canonical, dan hreflang.

### E8. Asset Waqf Inquiry

- **Pertanyaan:** Sub-pertanyaan dari tiketnya (rencana: "E8/E9 sub-pertanyaan dari tiketnya"): model dan alur pengajuan Wakif, status tindak lanjut nazhir, dan hubungannya dengan Campaign `wakaf`.
- **Prasyarat:** Grilling dan input nazhir. Ukuran L, skema.
- **Rujukan:** `.scratch/prd-audit/issues/07-asset-waqf-inquiry.md` (status `open`, belum digrilling).
- **Jawaban owner:** 2026-10-04: **grilling dengan nazhir** (belum dijawab di ronde ini).

### E9. Akun Tim CSR

- **Pertanyaan:** Empat sub-pertanyaan yang dibiarkan terbuka oleh `rilis-1-benda/issues/08` (akun sudah diputuskan masuk Rilis 1; email konfirmasi ke perusahaan dikerjakan lebih dulu, akun lengkap belakangan): (a) akun berjangkar pada orang dengan keanggotaan di perusahaan, atau pada perusahaan dengan beberapa orang; (b) apakah perusahaan diverifikasi, dan seberapa ringan; (c) apa yang bisa dilakukan Tim CSR setelah mendaftar; (d) berapa lama data kontaknya disimpan.
- **Rekomendasi:** [rekomendasi tidak ada di rencana; rencana hanya menetapkan urutan: email konfirmasi dulu (S), akun lengkap kemudian (L, skema)]
- **Kalau ditolak:** Email konfirmasi tetap bisa dibangun tanpa keputusan ini, tetapi akun lengkap tidak bisa dirancang; tanpa jawaban (d) retensi data kontak melanggar kehati-hatian UU PDP.
- **Rujukan:** `.scratch/rilis-1-benda/issues/08-tim-csr-account.md` ("What this does not decide"); `CONTEXT.md:42` (Tim CSR).
- **Jawaban owner:** 2026-10-04: (a) akun per orang plus keanggotaan perusahaan; (b) verifikasi ringan lewat domain email; (c) inquiry plus riwayat status plus **unduh laporan dampak Program yang dibiayai perusahaannya**; (d) retensi selama aktif ditambah 2 tahun setelah inquiry terakhir, lalu dianonimkan.

## Keputusan susulan: beta publik menggantikan staging (owner, 2026-10-04/05)

Owner menutup PR #224 (G-1 staging): tidak ada subdomain staging. Beta publik berjalan di domain utama dengan Sumopod sandbox. Owner menyetujui keempat rekomendasi koordinator:
1. Penanda mode beta: satu env server eksplisit; saat aktif hanya `https://api-pay-sandbox.sumopod.com` (host persis) yang diterima; tanpa penanda, sandbox tetap ditolak. Go-live = cabut penanda + isi URL live.
2. Banner "Beta, tidak ada uang nyata" di semua halaman, konfirmasi donasi, dan Receipt; situs tetap diindeks.
3. Setiap Payment dicap mode sandbox (perubahan skema, slot skema sebelum M-a); saat go-live data beta dikeluarkan dari total publik dan rekonsiliasi.
4. Beta menggantikan peran staging untuk gladi Gelombang 1; gladi tertutup C1 dengan uang nyata tetap menunggu M-a dan A-1.
Tiket: rilis-1-benda 92 (B-1). C5 tidak berubah (dokumen tetap volume lokal privat).
