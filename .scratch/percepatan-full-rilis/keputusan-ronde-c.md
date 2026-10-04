# Ronde keputusan C: C1 sampai C23 untuk dijawab owner sekaligus

Tanggal: 2026-10-04. Sumber: Track C di `.scratch/percepatan-full-rilis/plan.md` (rekomendasi di depan). Dokumen ini hanya mengumpulkan pertanyaan supaya owner bisa menjawab semuanya dalam satu pesan; belum ada yang diputuskan.

**Cara menjawab:** tulis `ya` untuk mengikuti rekomendasi, atau tulis jawaban lain pada baris "Jawaban owner" tiap butir. Menurut `docs/agents/issue-tracker.md`, bila owner menjawab beberapa pertanyaan dalam satu pesan, tiap jawaban dicatat sebagai tiketnya sendiri dan commit-nya menyebut bahwa semuanya mendarat bersama.

**Gerbang waktu (dari rencana):** C1 sampai C6 harus terjawab sebelum G0 selesai. Sisanya sebelum gelombang yang membutuhkannya.

**Catatan rujukan:** nomor baris diperiksa terhadap berkas pada 2026-10-04, sesudah amandemen `CONTEXT.md` dan PRD di PR yang sama. Rencana menyebut `CONTEXT.md:291` untuk C1; amandemen itu menambah satu baris, jadi teks Soft Launch kini ada di `CONTEXT.md:292` (judul istilah di baris 291).

---

## C1. Uang sebelum gerbang F2

- **Pertanyaan:** `CONTEXT.md:292` (istilah **Soft Launch**) melarang menerima uang publik sebelum gerbang Fase 2 lolos. Bolehkah ada gladi tertutup dengan uang nyata sebelum itu?
- **Rekomendasi:** Izinkan **gladi tertutup** setelah M-a dan A-1 merge: satu Campaign YIEM, tanpa promosi, nominal kecil. Soft Launch tetap berarti promosi publik, dan baru setelah M2. Amandemen `CONTEXT.md` (entri Soft Launch) menyebut perbedaannya.
- **Kalau ditolak:** M1 (donasi nyata pertama) tidak bisa dilakukan sebelum M2. Padahal M2 butuh dana nyata yang sudah lewat escrow 7 hari, jadi urutannya macet: M2 tidak bisa dibuktikan tanpa uang nyata, dan uang nyata tidak boleh ada sebelum M2. Pilihan lain yang tersisa hanya membuktikan semuanya di staging sandbox, yang tidak membuktikan penyedia nyata.
- **Rujukan:** `CONTEXT.md:291-292`; `plan.md` bagian "Definisi selesai dan milestone".
- **Jawaban owner:** ___

## C2. "Dua penyedia terekonsiliasi" pindah dari gerbang M2 ke M3

- **Pertanyaan:** PRD §11 (`docs/PRD-fund-for-indonesia.md:327`, baris Fase 2) menuntut "Payment dari dua penyedia terekonsiliasi" sebagai syarat lolos Fase 2. Xendit belum mulai. Pindahkan syarat itu ke M3?
- **Rekomendasi:** Ya. Soft Launch cukup dengan Sumopod. Syarat dua penyedia tetap wajib untuk Rilis 1 penuh (M3).
- **Kalau ditolak:** Soft Launch tertunda sampai Xendit lolos KYB dan adapter M-c selesai, yang bergantung pada vendor dan paling mungkin menentukan tanggal seluruh rencana.
- **Rujukan:** PRD §11 baris Fase 2 (`:327`); `plan.md` lajur X; `.scratch/rilis-1-benda/issues/18-second-payment-provider.md`.
- **Jawaban owner:** ___

## C3. Platform Fee

- **Pertanyaan:** Nilai awal fee saat rilis (PRD menyebut "usulan 5 persen untuk `donation` dan nol untuk Category bencana", `docs/PRD-fund-for-indonesia.md:310`). Berapa nilainya?
- **Rekomendasi:** 5% untuk `donation`; 0 untuk bencana, zakat, wakaf, dan hibah; tanpa fee di bawah Rp50.000 (ambang sudah ada di PRD FFI-01, `:122`, dan di `platform-fee-config.ts`).
- **Kalau ditolak:** Admin tidak punya nilai awal untuk dimasukkan di A5.3. Kode mengizinkan nilai berapa pun lewat panel Admin dan fee dibekukan per Payment, jadi mengubahnya kemudian tidak merusak data lama, tetapi nilai yang salah di Campaign pertama tidak bisa ditarik untuk Donation yang sudah masuk.
- **Rujukan:** PRD `:310-313`; `src/lib/money/platform-fee-config.ts`; `CONTEXT.md:186`.
- **Jawaban owner:** ___

## C4. Dokumen wajib

- **Pertanyaan:** Kapan dokumen Campaign (PRD §7.1) wajib diunggah di produk?
- **Rekomendasi:** Wajib sebelum M2. Untuk M1, dokumen YIEM diperiksa di luar produk dan Verifier mencatatnya.
- **Kalau ditolak:** Bila wajib sejak M1, tiket D-1 (penyimpanan dokumen privat, XL, skema) harus selesai sebelum donasi pertama dan jalur kritis M1 bertambah sekitar satu minggu builder. Bila tidak wajib sampai Rilis 1 penuh, Verifier memeriksa dokumen tanpa jejak di produk, yang melemahkan audit.
- **Rujukan:** PRD §7.1 (`docs/PRD-fund-for-indonesia.md:147`); `.scratch/rilis-1-benda/issues/03-documents.md`.
- **Jawaban owner:** ___

## C5. Penyimpanan dokumen

- **Pertanyaan:** Di mana dokumen Campaign disimpan?
- **Rekomendasi:** Bucket object storage yang kompatibel S3 dengan signed URL. Owner mengonfirmasi bahwa bucket itu terisolasi dari object storage milik stack lain di host.
- **Kalau ditolak:** Alternatifnya disk lokal atau volume uploads, yang menaikkan risiko (disk host sudah 81-84%, dan dokumen berisi KTP). Atau object storage yang berbagi dengan stack lain, yang mencampur akses.
- **Rujukan:** `.scratch/rilis-1-benda/issues/03-documents.md`; `plan.md` A3 dan tiket D-1.
- **Jawaban owner:** ___

## C6. Reveal rekening tujuan Payout

- **Pertanyaan:** Admin tidak bisa melihat nomor rekening tujuan Payout: `src/app/admin/payouts/[id]/page.tsx:70` hanya memilih `bankCode` dan `accountName`. Siapa boleh melihat nomornya, dan bagaimana dicatat?
- **Rekomendasi:** Hanya Admin penyelesai (yang mentransfer), dengan tombol reveal yang tercatat di tabel audit.
- **Kalau ditolak:** Bila semua Admin boleh melihat, permukaan data sensitif membesar dan audit kurang tajam. Bila tidak ada reveal, Payout manual mustahil tanpa psql, yang melanggar syarat "tanpa akses basis data" gerbang F2.
- **Rujukan:** `src/app/admin/payouts/[id]/page.tsx:70`; `.scratch/rilis-1-benda/issues/12-decrypting-a-bank-account-at-payout.md`; ADR 0012.
- **Jawaban owner:** ___

## C7. Kind saat peluncuran

- **Pertanyaan:** Kind Campaign apa yang dibuka saat peluncuran?
- **Rekomendasi:** `donation` saja, sampai ada mitra zakat (LAZ/BAZNAS) dan wakaf (nazhir BWI) serta review syariah untuk hibah.
- **Kalau ditolak:** Membuka zakat, wakaf, atau hibah lebih awal memerlukan Kind Authorisation dan keputusan legal yang belum ada (A4); risikonya bukan teknis melainkan kepatuhan.
- **Rujukan:** `CONTEXT.md:17-25` (Kind, Kind Authorisation); ADR 0013; PRD §10 (`docs/PRD-fund-for-indonesia.md:311-313`).
- **Jawaban owner:** ___

## C8. Lokasi dan penerima manfaat

- **Pertanyaan:** Bentuk data lokasi dan penerima manfaat pada Campaign (tiket F6, skema).
- **Rekomendasi:** Provinsi dari daftar statis, kabupaten/kota teks bebas, penerima manfaat plus jumlah opsional.
- **Kalau ditolak:** Daftar penuh provinsi sampai kecamatan menambah data referensi dan pemeliharaan; teks bebas penuh membuat pencarian dan filter lokasi tidak konsisten.
- **Rujukan:** PRD §6 (`docs/PRD-fund-for-indonesia.md:79`) dan §11 baris Fase 1.
- **Jawaban owner:** ___

## C9. Kategori wakaf

- **Pertanyaan:** Kategori wakaf tunai.
- **Rekomendasi:** Masjid, sekolah, fasilitas kesehatan, fasilitas umum (sama dengan PRD §6).
- **Kalau ditolak:** Kategori lain mengubah data checklist dan Akad Wakaf. Hanya relevan setelah wakaf dibuka (lihat C7).
- **Rujukan:** PRD `docs/PRD-fund-for-indonesia.md:82`.
- **Jawaban owner:** ___

## C10. Suspension tanpa Flag Verifier

- **Pertanyaan:** Boleh Admin menangguhkan Campaign tanpa Flag dari Verifier?
- **Rekomendasi:** Boleh, asal alasannya tercatat. Catatan: `CONTEXT.md:126` (istilah Suspension) dan ADR 0015 sudah menyatakan "tanpa Flag pun boleh selama alasannya tercatat", jadi butir ini kemungkinan hanya konfirmasi, bukan keputusan baru.
- **Kalau ditolak:** `CONTEXT.md` dan ADR 0015 harus diubah, dan Admin tidak bisa bertindak cepat atas laporan yang belum sempat di-Flag.
- **Rujukan:** `CONTEXT.md:125-126`; ADR 0015; `src/lib/campaign-lifecycle.ts` (suspensi menyelesaikan Flag yang terbuka, bukan mensyaratkannya, sekitar baris 1493-1522).
- **Jawaban owner:** ___

## C11. Settlement terlambat

- **Pertanyaan:** Donasi yang settle setelah Payment kedaluwarsa (ADR 0021 menyatakan tetap dibukukan) dan kini tak punya tempat: otomatis di-Refund, diusulkan sebagai Refund, atau dibiarkan?
- **Rekomendasi:** Diusulkan sebagai Refund kepada Admin, tidak otomatis (tiket M-d). Untuk Trip Fee, perilaku yang ada tetap (Refund otomatis, `rilis-1-benda/issues/40` dan `43`).
- **Kalau ditolak:** Bila otomatis, Refund uang nyata terjadi tanpa mata manusia. Bila dibiarkan, uang Donor tertahan tanpa penjelasan dan muncul di antrean rekonsiliasi.
- **Rujukan:** ADR 0021; `.scratch/rilis-1-benda/issues/40-trip-fee-settles-after-hold-expired-auto-refund.md`; `.../43-sweep-for-refunds-stuck-after-late-settlement.md`; `docs/runbooks/payment-reconciliation.md`.
- **Jawaban owner:** ___

## C12. Batas Campaign Active dan durasi

- **Pertanyaan:** Aturan maksimum tiga Campaign Active per Fundraiser dan durasi maksimum.
- **Rekomendasi:** Batas tiga dicabut setelah Usage Report pertama Fundraiser itu; durasi maksimum 12 bulan, wakaf dikecualikan (PRD FFI-04 sudah memuat 12 bulan dan pengecualian wakaf; yang baru adalah pencabutan batas tiga).
- **Kalau ditolak:** Batas tiga tetap permanen: Fundraiser yang sudah terbukti jujur tidak bisa berkembang. Mencabutnya tanpa syarat Usage Report menghilangkan sinyal kepercayaan.
- **Rujukan:** `src/lib/campaign-lifecycle.ts:607-650` (`requireWithinActiveCampaignLimit`); PRD FFI-04 (`docs/PRD-fund-for-indonesia.md:125`).
- **Jawaban owner:** ___

## C13. Tombol Google

- **Pertanyaan:** Tombol masuk dengan Google bila Google OAuth belum dikonfigurasi.
- **Rekomendasi:** Disembunyikan sampai dikonfigurasi (tiket H-2). Saat ini `src/lib/auth.ts:24-25` membaca `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` tanpa pengaman, dan halaman login `src/app/(auth)/login/page.tsx` menampilkan tombolnya.
- **Kalau ditolak:** Tombol yang tidak berfungsi tampil di produksi, atau Google OAuth harus disiapkan sebelum M1 (menambah langkah vendor).
- **Rujukan:** ADR 0022 (Google sign-in tidak memverifikasi email); `src/lib/auth.ts:24`; `plan.md` H-2.
- **Jawaban owner:** ___

## C14. Transfer hibah

- **Pertanyaan:** Batas kategori pada Campaign Transfer untuk hibah.
- **Rekomendasi:** Tanpa batas kategori sampai review syariah. Kode sekarang: hibah hanya ke hibah, lintas Kind ditolak (`src/lib/money/campaign-transfers.ts:27-36`, `:100`).
- **Kalau ditolak:** Bila ingin pembatasan kategori sekarang, perlu aturan yang belum didefinisikan dan tiket tambahan.
- **Rujukan:** ADR 0015; `src/lib/money/campaign-transfers.ts:27-36, :100`; PRD `:202`.
- **Jawaban owner:** ___

## C15. Rekap keuangan

- **Pertanyaan:** Bentuk rekap keuangan Admin (PRD §9; tiket A-6).
- **Rekomendasi:** Per periode, per Kind, per Campaign, plus ekspor CSV.
- **Kalau ditolak:** Definisi lain (misalnya per Program atau per penyedia) mengubah kueri dan CSV. Tanpa keputusan, tiket A-6 tidak bisa ditulis spesifik.
- **Rujukan:** PRD §9 dan FFI-17; `.scratch/rilis-1-benda/scorecard.md` ("Membuat rekap keuangan": "no code, and no definition anywhere").
- **Jawaban owner:** ___

## C16. Hold kursi Volunteer

- **Pertanyaan:** Batas hold kursi untuk mencegah penimbunan kursi (tiket V-1, review konkurensi).
- **Rekomendasi:** Maksimal 2 hold per akun, ditambah rate limit. Angka pasti ditulis di tiketnya dan sengaja tidak dipublikasikan di sini (menyamarkan angka anti-abuse).
- **Kalau ditolak:** Tanpa batas, satu akun bisa menimbun seluruh kuota Batch dan menutup pendaftar lain; batas terlalu ketat menghalangi pendaftar yang sah.
- **Rujukan:** `.scratch/rilis-1-benda/issues/50-seat-hoarding-without-limit.md` (status `needs-info`; menunggu PR #161 dan keputusan batas).
- **Jawaban owner:** ___

## C17. Email Volunteer

- **Pertanyaan:** Kapan email Volunteer (konfirmasi pendaftaran dan Refund Trip Fee) dibangun?
- **Rekomendasi:** Masuk M3 (tiket V-3), bukan sebelum.
- **Kalau ditolak:** Bila lebih awal, menambah pekerjaan di jalur sebelum M2. Bila ditiadakan, Volunteer tidak menerima konfirmasi apa pun di luar layar.
- **Rujukan:** `plan.md` tiket V-3; PRD §7 FFI-11.
- **Jawaban owner:** ___

## C18. Escrow 7 hari

- **Pertanyaan:** Apakah lama Escrow Hold tetap bisa diatur Admin (PRD FFI-17 menyebut "lama Escrow Hold" sebagai setelan Admin)?
- **Rekomendasi:** Jadikan 7 hari konstanta dan amandemen PRD FFI-17. Skema sekarang `escrowHoldDays Int @default(7)` (`prisma/schema.prisma:1436`) dan Payment menyalin nilainya saat dibuat.
- **Kalau ditolak:** Panel Admin untuk mengubah escrow harus dibangun dan diuji, dengan risiko mengubah perlindungan Donor tanpa review.
- **Rujukan:** PRD FFI-17 (`docs/PRD-fund-for-indonesia.md:144`); `prisma/schema.prisma:1436`; `.scratch/rilis-1-benda/issues/04-numbers-code-or-config.md`.
- **Jawaban owner:** ___

## C19. Demo Campaign

- **Pertanyaan:** Bagaimana Demo Campaign disembunyikan saat Campaign nyata pertama Active?
- **Rekomendasi:** Dengan flip manual: `SHOW_DEMO_CAMPAIGNS=false` pada langkah A6, bukan otomatis.
- **Kalau ditolak:** Otomatis menuntut kode dan pengujian tambahan; PRD §11 baris Fase 1 menyebut "saat Campaign nyata pertama Active", yang bisa dibaca otomatis.
- **Rujukan:** `CONTEXT.md:276` (Demo Campaign); `.scratch/prd-compliance-fase-0-2/issues/56-show-demo-campaigns-flag.md` (PR #215).
- **Jawaban owner:** ___

## C20. Receipt anonim

- **Pertanyaan:** Receipt untuk Donation anonim: tampilkan nama asli kepada pemegang token?
- **Rekomendasi:** Tetap menampilkan nama; hanya pemegang token Receipt (Donor sendiri) yang bisa melihatnya. Kode sekarang meneruskan `donation.donor?.name ?? donation.guestName` tanpa cabang `isAnonymous` (`src/app/receipt/[token]/page.tsx:57`, dicetak di `src/components/receipt/ReceiptView.tsx:80`), jadi ini mengesahkan perilaku yang ada.
- **Kalau ditolak:** Receipt harus menyembunyikan nama untuk Donation anonim, dan perlu diputuskan apa yang tercetak (misalnya "Donor anonim"), plus tes.
- **Rujukan:** `src/app/receipt/[token]/page.tsx:57`; `src/components/receipt/ReceiptView.tsx:80`; `.scratch/rilis-1-benda/scorecard.md` ("The leak").
- **Jawaban owner:** ___

## C21. Perubahan Bank Account

- **Pertanyaan:** Apakah mengganti rekening bagian dari change request Campaign?
- **Rekomendasi:** Bukan. Rekening dipilih per Payout dan setiap rekening diverifikasi sendiri (ADR 0018).
- **Kalau ditolak:** Perlu jenis Verification Request baru yang mengaitkan Campaign dan rekening, dan Payout yang sedang berjalan harus diputuskan nasibnya.
- **Rujukan:** ADR 0018; `CONTEXT.md:133` (Verification Request); `CONTEXT.md` entri Bank Account.
- **Jawaban owner:** ___

## C22. Disbursement API

- **Pertanyaan:** Apakah Payout otomatis lewat API penyedia dibangun untuk Rilis 1?
- **Rekomendasi:** Ditunda. Transfer manual dengan bukti tetap berlaku (ADR 0006).
- **Kalau ditolak:** Menambah pekerjaan besar di Sumopod dan Xendit (disbursement) dan risiko uang keluar otomatis; juga mengubah rencana syarat dua mata Admin.
- **Rujukan:** ADR 0006; ADR 0003; `docs/integrasi-sumopod.md` (Sumopod tanpa disbursement).
- **Jawaban owner:** ___

---

## C23. Item perluasan (E1 sampai E9)

Ketujuh item perluasan Fase 3 masuk Rilis 1 (keputusan owner 2026-10-04, diamandemen di `CONTEXT.md` dan PRD §6 dan §11). Tiap item butuh grilling singkat sebelum dibuat tiketnya; pertanyaan di bawah adalah yang sudah ada di rencana. Pesan relay rencana terpotong pada daftar E1 sampai E8, jadi E5 dan E8 ditandai [TERPOTONG] dan tidak diisi dengan tebakan.

### E1. Tautan pendek

- **Pertanyaan:** Domain atau prefix mana yang dipakai untuk tautan pendek?
- **Rekomendasi:** [rekomendasi tidak ada di rencana; owner menentukan domain dan prefix]
- **Kalau ditolak:** Tiket E1 tidak bisa mulai; Traffic Source per tautan di FFI-06 tetap memakai tautan panjang.
- **Rujukan:** PRD FFI-06 (`docs/PRD-fund-for-indonesia.md:127`); `.scratch/prd-audit/issues/12-campaign-share-not-wired.md`.
- **Jawaban owner:** ___

### E2. Pengalihan Dormant Balance (aturan 180 hari)

- **Pertanyaan:** Apa dasar legal aturan 180 hari tanpa Payout dan tanpa tanggapan atas tiga pengingat sebelum saldo dialihkan?
- **Rekomendasi:** Counsel legal memastikan dasarnya (bagian A4) sebelum kode pengalihan ditulis. Laporan 60 hari dan Campaign Transfer yang ada tetap berjalan; yang belum ada adalah pelacakan pengingat dan pengalihannya (`.scratch/prd-compliance-fase-0-2/issues/37-dormant-balance-report.md`, kotak 2).
- **Kalau ditolak:** Pengalihan tidak bisa dibangun dengan aman; saldo dormant tetap Campaign Balance biasa dan item perluasan ini tidak selesai di Rilis 1.
- **Rujukan:** `CONTEXT.md:247-248` (Dormant Balance); PRD §7.3; `src/lib/money/dormant-balances.ts`.
- **Jawaban owner:** ___

### E3. Refund yang diminta sendiri oleh Donor

- **Pertanyaan:** Jendela waktu, batas per Kind, dan pengamanan anti-abuse untuk Refund yang dimulai Donor.
- **Rekomendasi:** [rekomendasi angka tidak ada di rencana; angka anti-abuse sengaja tidak ditulis publik]. Prinsip: kode uang, wajib review independen sonnet.
- **Kalau ditolak:** Refund tetap hanya dimulai Admin; item perluasan ini tidak selesai dan PRD §7.2 tidak berubah.
- **Rujukan:** PRD §7.2 (`docs/PRD-fund-for-indonesia.md:158`); `CONTEXT.md` entri Refund; `src/lib/money/refunds.ts`.
- **Jawaban owner:** ___

### E4. Anggota tim untuk Fundraiser organisasi

- **Pertanyaan:** Peran apa yang dimiliki anggota, dan bolehkah anggota meminta Payout?
- **Rekomendasi:** Anggota **tidak** boleh meminta Payout; permintaan Payout tetap milik akun Fundraiser utama organisasi.
- **Kalau ditolak:** Bila anggota boleh meminta Payout, kode uang bertambah (aturan dua orang dan pemisahan tugas harus dihitung ulang) dan review independen jadi wajib lebih berat.
- **Rujukan:** `CONTEXT.md:106` (Partner Organisation: "anggota tim menyusul"); ADR 0005 (peran sebagai Assignment terpisah).
- **Jawaban owner:** ___

### E5. [TERPOTONG]

- **Catatan:** Baris E5 hilang dari pesan relay. Tujuh item perluasan menurut PRD ada tujuh (bahasa Inggris, WhatsApp, tautan pendek, impor settlement otomatis, pengalihan Dormant Balance, Refund oleh Donor, anggota tim); enam sudah punya nomor E di rencana, jadi kemungkinan E5 adalah impor settlement otomatis. Ini inferensi koordinator, bukan teks rencana. Pertanyaan, rekomendasi, dan konsekuensi menunggu isi aslinya.
- **Jawaban owner:** ___

### E6. Notifikasi WhatsApp

- **Pertanyaan:** Penyedia (BSP) mana dan berapa biayanya, dan model consent apa yang dipakai?
- **Rekomendasi:** [rekomendasi tidak ada di rencana]. Persetujuan WhatsApp harus sesuai UU PDP (A4) dan verifikasi Meta/WhatsApp Business dimulai hari 0 (A3).
- **Kalau ditolak:** WhatsApp tidak masuk Rilis 1 dan item perluasan ini tidak selesai; email transaksional tetap cukup untuk gerbang Fase 0 sampai 2.
- **Rujukan:** `plan.md` A3, A4, G5; PRD §6 daftar pengecualian (dengan amandemen 2026-10-04).
- **Jawaban owner:** ___

### E7. Versi bahasa Inggris

- **Pertanyaan:** Pustaka dan aturan slug.
- **Rekomendasi:** `next-intl`; slug tetap Indonesia. Dikerjakan sendirian di G5 karena menyentuh semua halaman, dengan ADR kunci di G1.
- **Kalau ditolak:** Pustaka atau slug lain mengubah ADR i18n dan seluruh ekstraksi teks; i18n menyentuh semua halaman sehingga keputusan terlambat mahal. Saat ini belum ada pustaka i18n di `package.json`.
- **Rujukan:** PRD §9 baris Bahasa (`docs/PRD-fund-for-indonesia.md:303`); `.scratch/prd-audit/research/01-fase-0-1.md` (⚠️ 2).
- **Jawaban owner:** ___

### E8. [TERPOTONG]

- **Catatan:** Baris E8 hilang dari pesan relay; rencana hanya menyebut "E8/E9 sub-pertanyaan dari tiketnya". Kemungkinan E8 adalah Asset Waqf Inquiry (`.scratch/prd-audit/issues/07-asset-waqf-inquiry.md`, status `open`, belum digrilling, pertanyaannya: model dan alur pengajuan Wakif, status tindak lanjut nazhir, dan hubungannya dengan Campaign `wakaf`), tetapi ini inferensi koordinator, bukan teks rencana. Menunggu isi aslinya.
- **Jawaban owner:** ___

### E9. Akun Tim CSR

- **Pertanyaan:** Empat sub-pertanyaan yang dibiarkan terbuka oleh `rilis-1-benda/issues/08` (akun sudah diputuskan masuk Rilis 1; email konfirmasi ke perusahaan dikerjakan lebih dulu, akun lengkap belakangan): (a) akun berjangkar pada orang dengan keanggotaan di perusahaan, atau pada perusahaan dengan beberapa orang; (b) apakah perusahaan diverifikasi, dan seberapa ringan; (c) apa yang bisa dilakukan Tim CSR setelah mendaftar; (d) berapa lama data kontaknya disimpan.
- **Rekomendasi:** [rekomendasi tidak ada di rencana; rencana hanya menetapkan urutan: email konfirmasi dulu (S), akun lengkap kemudian (L, skema)]
- **Kalau ditolak:** Email konfirmasi tetap bisa dibangun tanpa keputusan ini, tetapi akun lengkap tidak bisa dirancang; tanpa jawaban (d) retensi data kontak melanggar kehati-hatian UU PDP.
- **Rujukan:** `.scratch/rilis-1-benda/issues/08-tim-csr-account.md` ("What this does not decide"); `CONTEXT.md:42` (Tim CSR).
- **Jawaban owner:** ___
