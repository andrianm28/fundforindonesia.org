# Plan: percepatan full rilis fundforindonesia.org (Rilis 1 penuh, 2026-10-04)

> Disalin koordinator dari pesan relay sesi VPS (2026-10-04). Pesan itu TERPOTONG; bagian yang
> hilang dipulihkan dari relay kedua (2026-10-04, verbatim). Yang masih hilang ditandai [TERPOTONG]:
> kalimat pembuka Context dan butir A1 nomor 2 s/d 6. Jangan menebak isinya.
> Detail host (IP, hostname, nama stack lain, path server) sengaja dihapus karena repo ini publik.
> Owner menyetujui rencana ini pada 2026-10-04.

## Context

[TERPOTONG: kalimat pembuka Context "Owner minta rencana percepata..." hilang dari relay; kalimat di bawah disusun koordinator dari sisa pesan.]

Owner minta rencana percepatan sampai **rilis penuh: semua tiket dan semua fitur**. Keputusan: YIEM izinnya lengkap; **ketujuh item perluasan Fase 3 MASUK Rilis 1** (membalik Q12–Q18 prd-audit 05); tiket 25 **tetap A** (owner-only dispatch) + required reviewer + branch protection (repo ternyata publik → gratis).

**Kondisi terverifikasi:**
- Kode: Fase 0 lengkap, jalur uang Fase 1 lengkap, kode backend Volunteer Trip (Fase 3) lengkap. Celah ada di **layar** yang API-nya sudah ada. Terbesar: Admin tidak bisa melihat nomor rekening tujuan Payout (`src/app/admin/payouts/[id]/page.tsx:70` hanya memilih `bankCode` dan `accountName`), jadi Payout manual mustahil tanpa psql.
- Produksi: rilis bac0127 jalan, semua Campaign demo. Donasi mati (flag build false, `PAYMENT_PROVIDER` kosong), SMTP kosong. **DB produksi baru tanpa backup terjadwal** (cron lama gagal tiap malam "No such container"; offsite tidak mencakup dump baru). `NEXTAUTH_URL` = domain lama (bukan apex). Disk 81%, log Docker tidak dirotasi. Cron jobs belum terpasang. `main` tanpa proteksi.
- Pipeline: CI median 4,3 menit, lalu CD 5–9 menit. Bukan bottleneck. **Jalur kritis = langkah owner, vendor, legal, dan keputusan.**

## Definisi selesai dan milestone

**Rilis 1 penuh** = keempat gerbang PRD §11 lolos di produksi tanpa psql; semua cakupan Fase 0–3 memenuhi standar bukti (kode + tes + layar yang bisa dijangkau); ketujuh item perluasan + Asset Waqf Inquiry + akun Tim CSR selesai; Track D (hardening) beres; nol tiket ready-for-human/needs-info/needs-triage tersisa.

| Milestone | Bukti gerbang | Sisa utama |
|---|---|---|
| **M0 Jaring pengaman** | Backup terjadwal + offsite + restore drill tercatat, alert berfungsi, cron jobs 200, `NEXTAUTH_URL` di apex, GitHub terproteksi | Hanya langkah host/GitHub (Track A1–A2) |
| **M1 Donasi nyata pertama** (gerbang F0+F1) | Campaign YIEM nyata lolos Verification Request dan tampil; satu donasi QRIS nyata settle; Receipt email diterima | Kode Gelombang 1 + Sumopod produksi + SMTP + setup YIEM di produk |
| **M2 Soft Launch** (gerbang F2) | Dari layar saja: Payout → Usage Report → Payout kedua → Refund (3 Admin) → rekonsiliasi di layar Admin | Kode Gelombang 2 + jendela escrow 7 hari |
| **M3 Rilis 1** (gerbang F3 + semua fitur) | Volunteer Trip nyata sampai sertifikat dengan satu Trip Fee nyata dan satu Refund Trip Fee; ketujuh item perluasan, Asset Waqf, dan Tim CSR lolos uji terima; **gerbang "Payment dari dua penyedia terekonsiliasi" (semula syarat Fase 2/M2) kini di sini**, keputusan owner C2 2026-10-04 | Gelombang 3–5 + Xendit + onboarding WhatsApp + kalender Batch |

> **Diputuskan 2026-10-04 (C1, C2):** gladi tertutup dengan uang nyata (satu Campaign YIEM, tanpa promosi, nominal kecil) diizinkan setelah M-a dan A-1 merge, sebelum M2; Soft Launch tetap berarti promosi publik dan baru setelah M2. Gerbang "dua penyedia" pindah dari M2 ke M3, jadi M2 cukup dengan Sumopod; Xendit (M-c) tetap wajib untuk M3. Lihat `keputusan-ronde-c.md`.

## Pengungkit percepatan

1. **Semua lead time eksternal dimulai hari 0** paralel: KYB Sumopod produksi, Xendit, verifikasi Meta/WhatsApp Business, counsel legal, Google OAuth. Inilah jalur kritis sebenarnya.
2. **Staging sandbox** (keputusan owner): M1/M2/M3 diuji end-to-end dengan Sumopod sandbox sebelum uang nyata; verifikasi kode tidak menunggu KYB.
3. **Satu ronde grilling** untuk semua keputusan (daftar C), termasuk pertanyaan terbuka item perluasan.
4. **Lajur builder paralel dengan aturan konflik file**: maksimal 8 agent, tetapi satu PR skema pada satu waktu; builder menjalankan tes terkait + tsc + lint saja, full suite di CI; vitest di-shard 3 arah; merge dibatch → satu CD + satu Deploy per gelombang.
5. **Bersih-bersih tiket sekali jalan** dalam satu PR dokumen, plus semua tiket baru ditulis dalam satu batch.

## Status eksekusi (sesi VPS, 2026-10-04)

- A1-1/2 backup malam DB produksi + volume uploads, offsite terenkripsi retensi 90 hari; cron backup lama yang mati dinonaktifkan.
- A1-3 restore drill lulus (4 s, jumlah baris identik).
- A1-6 NEXTAUTH_URL apex, galang 301 ke apex.
- A1-8 hitungan read-only: ADMIN=2 & VERIFIER=2 (perlu Admin ke-3); tidak ada role lama tanpa assignment; SUSPENDED tanpa log=0; key id tunggal; donationBalance>0: 5 user (total Rp1.371.884).
- A2 reviewer production + branch protection (test/build/migrations/ratchet/e2e) + Dependabot alerts + secret scanning + push protection.
- Monitoring host: /api/health, umur backup, disk 85%; alert terkirim setelah owner memperbaiki kredensial kanal alert.
- A1-7 cron jobs ditunda: menunggu reminders-skip-demo-campaigns. **Diperbarui 2026-10-04 (relay ronde C):** reminders-skip-demo-campaigns merge (#219) dan ter-deploy di 53fe2d2; A1-7 selesai: cron terpasang tiap 15 menit, secret lewat stdin, logrotate mingguan; dua uji tangan http 200 lalu semua hitungan 0 (prd-compliance 45 done). Deploy 53fe2d2 live; rollback target bac0127.
- Owner: uji login apex, kanal alert, Admin ke-3, saldo dompet lama, disk 84% naik ~0,5 GB/jam (build stack lain di host).

## Pembagian sesi (sesuai CLAUDE.md)

- **Sesi VPS:** hanya ops host + setelan GitHub; setiap perintah yang mengubah sesuatu ditunjukkan dulu dan dijalankan setelah owner bilang "ok"; nilai rahasia tidak pernah ditampilkan.
- **Sesi koordinator cloud:** salin rencana ini ke `.scratch/percepatan-full-rilis/plan.md`, tandai rencana lama superseded, tulis tiket, dispatch builder (sonnet), review independen kode uang, merge setelah "ya" owner.
- **Owner:** vendor, legal, setup di produk, dispatch `deploy.yml`.
- **Tempat tiket baru:** celah Rilis 1 di `.scratch/rilis-1-benda/issues/` (58+), ops di `.scratch/go-live-ops/issues/` (tanpa detail host), item perluasan di `.scratch/fase-3-perluasan/issues/`.

## Track A: langkah owner dan host

**A1. Host** (sesi VPS)
1. Backup malam DB produksi dan volume uploads, offsite terenkripsi retensi 90 hari; cron backup lama yang mati dinonaktifkan (selesai, lihat Status eksekusi). [TERPOTONG: butir A1 nomor 2 s/d 6 pada relay kedua terpotong ("2. Backup volume uploads, mal..." lalu lompat ke 7); teks butir 2-6 di bawah disusun koordinator, bukan verbatim.]
2. Backup volume uploads, malam hari dan offsite.
3. Restore drill ke Postgres sementara, dicatat sebagai `docs/runbooks/restore.md` lewat koordinator.
4. Alert: perbaiki kanal yang rusak (laporan ops: SMTP 535); cek `/api/health`, umur backup, disk 85%; uptime eksternal.
5. Log Docker: rotasi (`max-size`/`max-file`); prune image tak terpakai; hapus sisa worktree cutover dan berkas cadangan compose lama di host.
6. Set `NEXTAUTH_URL` ke apex, recreate app, uji login.
7. Pasang cron `POST /api/internal/jobs/run` (prd-compliance 45); jalankan dua kali dengan tangan: 200, lalu nol.
8. Hitungan read-only: jumlah ADMIN/VERIFIER; pemegang `role` lama tanpa assignment; SUSPENDED tanpa log; baris HMAC key lama; `donationBalance > 0`.
9. Putuskan pensiun kibi-clone (setelah ~2026-10-10).

**A2. GitHub** (owner, atau lewat API setelah "ok")
- Required reviewer `andrianm28` di environment `production`.
- Branch protection `main`: cek wajib test, build, migrations, ratchet; tanpa force-push/delete.
- Dependabot alerts, secret scanning, push protection.
- Catat tanggal kedaluwarsa token GHCR.

**A3. Vendor** (hari 0, lalu menunggu)
- Sumopod produksi: KYB atas nama entitas yang benar (ADR 0011), base URL, API key, `whsec`, webhook `/api/webhooks/sumopod`.
- Sumopod sandbox untuk mode beta di domain utama (B-1); SMTP relay.
- Xendit: daftar, kunci sandbox, mulai KYB produksi.
- Meta Business / BSP WhatsApp: verifikasi dan persetujuan template.
- **Google OAuth: disiapkan sebelum M1** (keputusan C13, bukan lagi opsional). Buat OAuth client di akun Google milik FFI (bukan akun pribadi), dengan redirect URI di domain apex (`https://<apex>/api/auth/callback/google`); isi `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` di env produksi (nilai tidak masuk repo). Selama env kosong, tombol Google tersembunyi otomatis (#223), jadi langkah ini tidak memblokir deploy tetapi harus selesai sebelum flip M1 (A6).
- Penyimpanan dokumen (C5): **volume lokal di host, bukan bucket S3**; tidak ada pembelian atau akun bucket. Volume privat terpisah dari `public/uploads`, dimasukkan sesi VPS ke backup malam dan offsite terenkripsi saat D-1 dideploy.
- DSN GlitchTip.

**A4. Legal dan syariah** (owner + counsel, hari 0)
- Dokumen izin YIEM; perjanjian kerja sama PT–YIEM dan atas nama siapa dana dihimpun; status PSE Lingkup Privat; entitas nyata + kontak untuk Terms/Privacy (operator-rule-gaps 03); UU PDP (kontak perlindungan data, prosedur insiden 3×24 jam, jadwal retensi); kewajiban AML/PPATK; penasihat syariah untuk hibah; mitra zakat (LAZ/BAZNAS) dan wakaf (nazhir BWI); persetujuan WhatsApp sesuai PDP.

**A5. Setup di produk** (setelah deploy Gelombang 1)
1. Tetapkan ≥1 VERIFIER dan ≥3 ADMIN (orang berbeda).
2. Daftarkan YIEM sebagai Partner Organisation; catat Fundraising Permit, Collecting Entity, Kind Authorisation `donation`.
3. Masukkan aturan Platform Fee lewat panel Admin (A-1, tiket 88). **Tidak ada nilai awal yang ditetapkan di rencana** (keputusan C3): owner mengisi nilainya sendiri di langkah ini.
4. Rekening YIEM diverifikasi; Campaign pertama dibuat, diajukan, disetujui. **Gerbang F0.**

**A6. Flip ke M1**: isi env Sumopod produksi, SMTP, `PARTNERSHIP_TEAM_EMAIL`; `SHOW_DEMO_CAMPAIGNS` tidak perlu di-flip: Demo Campaign tersembunyi otomatis begitu ada Campaign nyata Active (tiket 91, keputusan C19; flag tetap penimpa manual); repo variable `NEXT_PUBLIC_DONATIONS_ENABLED=true` → CD + Deploy; donasi QRIS kecil dari owner sendiri.

**A7. Drill M2** (≥7 hari setelah M1; butuh 3 Admin + Fundraiser YIEM).

**A8. M3**: flag VOLUNTEER; Trip dan Batch nyata (berangkat ≥14 hari agar tier Refund penuh teruji); dua Volunteer; uji terima item perluasan di produksi; rekonsiliasi Xendit dan Sumopod.

## Track B: lajur kode (builder sonnet, worktree masing-masing)

**Aturan serialisasi:**
- Satu PR yang menyentuh `prisma/schema.prisma`/migrasi pada satu waktu; koordinator membagi timestamp migrasi.
- `src/lib/domain-errors.ts` dan `src/lib/money/errors.ts` hanya ditambah, di-merge berurutan.
- `CONTEXT.md`, `.env.example`, `ci/baselines.json`, `package.json`, dan dokumen agent hanya diedit koordinator.
- Baris di `AdminSidebar.tsx` ditambah satu per satu, di-merge berurutan.
- Tidak bersamaan: M-e dengan F4 (`campaign-lifecycle.ts`), H-3 dengan H-4 (`next.config.mjs`).

**Menuju M1:** Pra-M1 (wajib sebelum flip)

| ID | Tiket baru | Isi | Ukuran |
|---|---|---|---|
| M-a | payout-reveal-account-number | Nomor penuh hanya untuk Admin penyelesai, saat APPROVED, bukan requester/approver; tabel audit reveal (skema); perbaiki tes `page.test.tsx:104`; buka ulang premis rilis-1-benda 12 | S |
| A-1 | admin-platform-fee-page | Layar aturan Platform Fee + riwayat di atas API yang sudah ada; nilainya diisi Admin di A5.3 (C3), bukan konstanta | M |
| P2 | checkout-fee-hold-disclosure | Persentase fee, Escrow Hold, dan jumlah bersih di konfirmasi donasi | S |
| P1 | admin-moderasi-door | Tautan ke /admin dan /moderasi menurut role (rilis-1-benda 05) | S |
| S-0 | contract release | Drop kolom status/role lama (legacy-status-contract 03, retire-role-hierarchy 03) sebelum data nyata, setelah hitungan A1 aman | S+S |

Baris H-1, H-2, H-3a, dan B-1 pada tabel berikut juga pra-M1.

**Nomor tiket (ditulis builder di branch masing-masing, bukan di PR dokumen ini):** P1 = `rilis-1-benda` 86, P2 = 87, A-1 = 88, M-a = 89 (ditulis koordinator, `rilis-1-benda/issues/89-payout-reveal-account-number.md`). Peta tiket ada di PR #222 (`claude/full-rilis-g0-tickets`).


| ID | Tiket baru | Isi | Ukuran |
|---|---|---|---|
| H-1 | rate-limit-auth-donation-upload | Rate limit login, register, donasi tamu, kirim ulang verifikasi, upload | M |
| H-2 | env-validation-and-auth-url | `assertProductionEnv` mencakup FIELD_*, JOBS_SECRET, NEXTAUTH_URL = host publik; tombol Google disembunyikan bila belum dikonfigurasi | S |
| H-3a | robots-and-powered-by | `src/app/robots.ts`, `poweredByHeader:false` | S |
| S-0 | contract release | Drop kolom `status`/`role` lama (legacy-status-contract 03, retire-role-hierarchy 03) **sebelum data nyata**, setelah hitungan A1 aman | S+S |
| ~~G-1~~ | ~~staging-environment~~ | **Dibatalkan 2026-10-04 (keputusan owner):** tidak ada subdomain staging; PR #224 ditutup tanpa merge, branch disimpan untuk dipakai ulang. Digantikan B-1. | - |
| B-1 | beta-sandbox-mode (rilis-1-benda 92) | Beta publik di domain utama dengan Sumopod sandbox: penanda env server eksplisit (hanya host sandbox persis via https; tanpa penanda sandbox tetap ditolak); banner "Beta, tidak ada uang nyata" di semua halaman, konfirmasi donasi, dan Receipt; situs tetap diindeks; setiap Payment dicap mode sandbox (skema, slot skema sebelum M-a) dan dikeluarkan dari total publik dan rekonsiliasi saat go-live. Review uang dan keamanan. | M, skema |

**Menuju M2:**

| ID | Tiket baru | Isi | Ukuran |
|---|---|---|---|
| A-7 | admin-escrow-hold-setting (tiket 90) | Setelan lama Escrow Hold di Admin, disalin ke Payment saat dibuat, riwayat dengan aktor (C18); kode uang, review independen | M, skema |
| A-8 | demo-campaigns-auto-hide (tiket 91) | Demo Campaign tersembunyi otomatis begitu ada Campaign nyata Active; `SHOW_DEMO_CAMPAIGNS` penimpa manual (C19) | S |
| A-2 | admin-reconciliation-page | Laporan `/api/admin/reconcile`, form provider-withdrawal, antrean webhook needs-review; perbarui runbook | L |
| D-1 | private-document-store | rilis-1-benda 03: model Document, **volume privat lokal di host (C5)**, disajikan lewat route ber-ACL (Verifier, Fundraiser pemilik, Admin), unggah saat create/edit, viewer Verifier, baris checklist nonaktif sampai dokumen ada | XL, skema |
| F2 | fundraiser-complete-and-cancellation-request | Tandai Completed + ajukan pembatalan | S-M |
| F3 | verifier-flag-admin-urgent | Form Flag + dismiss, toggle Urgent | M |
| A-3 | admin-scrutiny-markers | Daftar penanda audit | S |
| N-1 | payout-refund-suspension-emails | Email PRD 7.2 (lanjutan prd-compliance 32) | M |
| H-4 | upload-hardening-and-serving | Uji `/uploads` di standalone; route/alias; magic-byte atau re-encode | M |
| H-5 | glitchtip-error-monitoring | SDK Sentry-compatible, scrub PII | M |
| H-3b | csp-report-only | CSP report-only + Permissions-Policy | S |
| M-b | provider-stamp-payout-refund-legs | Penanda penyedia di kaki Payout/Refund (`perProviderIsExact`) | M |

**Menuju M3 (sisa cakupan F0–F3):**

| ID | Tiket baru | Isi | Ukuran |
|---|---|---|---|
| F1 | campaign-update-form-and-tab | Form + tab Kabar Terbaru | M |
| N-2 | campaign-update-email-to-donors | Email ke Donor; perlu dekripsi email tamu, review privasi | M |
| F4 | draft-rejected-edit-screen | Layar edit + change request target/tenggat; perbaiki link mati `admin/campaigns/page.tsx:112` | M |
| F5 | fundraiser-donation-list | Daftar donasi untuk Fundraiser, aman anonimitas | S |
| F6 | location-beneficiaries | Lokasi + penerima manfaat | M, skema |
| P3 | wakaf-hibah-csr-landings-and-zakat-cta | Landing wakaf/hibah/CSR, tautan /program, CTA zakat | M |
| P4 / P5 | contact, Terms dan Privacy | Copy menunggu A4 | S-M |
| A-4 | admin-campaign-transfers-screen | Layar transfer Campaign | M, review uang |
| A-5 | admin-program-crud | CRUD Program | M |
| A-6 | finance-recap-and-csv-export | Rekap keuangan + ekspor CSV (PRD §9) | M |
| M-d | late-settlement-refund-surfacing | Settlement terlambat diusulkan sebagai Refund | S-M |
| M-e | active-limit-usage-report-exemption + campaign-max-duration-12mo | Batas tiga Active dicabut setelah Usage Report; durasi maks 12 bulan | S+S |
| V-1 | rilis-1-benda 50 (seat hoarding) | Batas hold kursi | S-M, review konkurensi |
| V-2 | trip-fee-payout-panel | Panel Payout Trip Fee | M, review uang |
| V-3 | trip-fee-volunteer-emails | Email Volunteer | M |

**Lajur X: penyedia kedua** (wajib di Rilis 1; gerbang F2/F3 butuh dua penyedia, impor settlement bergantung padanya)
- **M-c xendit-adapter:** verifikasi dulu field fee/settlement di dokumentasi Xendit; registry, readiness guard, callback token constant-time + anti-replay, VA/e-wallet, UI metode pembayaran, `XENDIT_*`. XL, setelah M-b.

**Lajur E: item perluasan** (folder `fase-3-perluasan`, masing-masing perlu grilling singkat dulu)

| ID | Item | Prasyarat | Ukuran |
|---|---|---|---|
| E1 | Tautan pendek | Domain/prefix; skema | S |
| E2 | Pengalihan Dormant Balance 180 hari: tiga pengingat, predikat, layar transfer, notifikasi Donor | Cron A1, A-4, aturan legal | M, skema |
| E3 | Refund diminta Donor | Mengubah PRD 7.2 dan ADR 0018; aturan kelayakan dan anti-abuse | M-L, review uang |
| E4 | Anggota tim organisasi: membership, peran, undangan, akses Payout | Grilling peran | L, skema, review uang |
| E5 | Impor settlement otomatis | Setelah M-c | M-L |
| E6 | Notifikasi WhatsApp: notifier di samping mail, consent | Onboarding Meta (A3) dan PDP | L |
| E7 | Bahasa Inggris (i18n) | `next-intl` dengan **slug diterjemahkan** (keputusan E7); ADR i18n di Gelombang 1 mendefinisikan peta pathname per bahasa, canonical, dan hreflang, plus konvensi kunci; ekstraksi penuh paling akhir dan sendirian | XL |
| E8 | Asset Waqf Inquiry (prd-audit 07) | Grilling, input nazhir | L, skema |

| E9 | Akun Tim CSR (rilis-1-benda 08): email konfirmasi ke perusahaan (S) dulu, akun lengkap belakangan | Grilling empat sub-pertanyaan | L, skema |

**Lajur T: throughput dan kualitas**
- H-6 vitest shard 3 arah (perbarui `ci/deploy-gate.sh` + tesnya).
- H-7 loop tes race real-DB `campaign-transfer`.
- E2E untuk setiap layar baru.
- Merge #211; tunda #212–#214; tutup #95.

**Lajur D: dokumen** (koordinator/haiku)
- PR housekeeping (Track D).
- Runbook incident (kill switch: kosongkan `PAYMENT_PROVIDER` lalu restart), rollback, restore, secrets, deploy.
- PRD §6/§11 + `CONTEXT.md`: definisi Rilis 1 kini memuat ketujuh item perluasan, plus keputusan dari daftar C.
- Catatan pembalikan Q12–Q18 bertanggal di prd-audit 05 (ditambahkan, bukan menulis ulang).

**Estimasi kasar:** pra-M1 ~8 hari-builder; M2 ~20; M3: sisa F0–F3 ~30, Xendit ~6, item perluasan + E8–E9 ~35. Total ~100 hari-builder ≈ 4–5 minggu kalender dengan 5–6 lajur. Kalender sebenarnya ditentukan KYB vendor, onboarding Meta, legal, escrow 7 hari, dan tanggal Batch.

## Track C: satu ronde keputusan (rekomendasi di depan)

> **Dijawab owner 2026-10-04** (relay sesi VPS); jawaban lengkap per butir ada di `keputusan-ronde-c.md`. Daftar di bawah adalah rekomendasi asli. **Menyimpang dari rekomendasi:** C3 (tanpa angka awal; Admin mengisi di A5.3 lewat tiket 88, yang ada di PR #228 dan belum merge), C5 (volume lokal di host, bukan S3), C13 (Google OAuth disiapkan sebelum M1), C18 (Escrow Hold setelan Admin, PRD FFI-17 tetap; tiket 90), C19 (Demo Campaign tersembunyi otomatis; tiket 91), E7 (slug diterjemahkan), E2 (dibangun setelah counsel; pelacakan pengingat boleh duluan), E6 (grilling terpisah). Sisanya sesuai rekomendasi.

- **C1. Uang sebelum gerbang F2.** `CONTEXT.md:291` melarang uang publik sebelum gerbang F2. Rekomendasi: izinkan **gladi tertutup** setelah M-a + A-1 merge (satu Campaign YIEM, tanpa promosi, nominal kecil). Soft Launch = promosi publik setelah M2. Amandemen `CONTEXT.md`.
- **C2. "Dua penyedia terekonsiliasi"** pindah dari gerbang M2 ke M3 (Xendit belum mulai); Soft Launch cukup Sumopod.
- **C3. Platform Fee:** 5% untuk `donation`; 0 untuk bencana, zakat, wakaf, hibah; tanpa fee di bawah Rp50.000.
- **C4. Dokumen** wajib sebelum M2; untuk M1 dokumen YIEM di luar produk.
- **C5. Storage:** bucket S3-compatible + signed URL; owner konfirmasi isolasi dari object storage milik stack lain di host.
- **C6. Reveal rekening:** hanya Admin penyelesai, tercatat di tabel audit.
- **C7. Kind saat peluncuran:** `donation` saja sampai ada mitra zakat/wakaf dan review syariah hibah.
- **C8. Lokasi:** provinsi dari daftar statis, kabupaten/kota teks bebas, penerima manfaat + jumlah opsional.
- **C9. Kategori wakaf:** masjid, sekolah, fasilitas kesehatan, fasilitas umum.
- **C10.** Admin boleh menangguhkan tanpa Flag Verifier, asal ada alasan.
- **C11.** Settlement terlambat → diusulkan sebagai Refund, tidak otomatis.
- **C12.** Batas tiga Active dicabut setelah Usage Report pertama; durasi maks 12 bulan, wakaf dikecualikan.
- **C13.** Google: tombol disembunyikan sampai dikonfigurasi.
- **C14.** Transfer hibah tanpa batas kategori sampai review syariah.
- **C15.** Rekap keuangan per periode × Kind × Campaign + CSV.
- **C16.** Hold kursi maks 2 per akun + rate limit; angka pasti di tiket yang disamarkan.
- **C17.** Email Volunteer untuk konfirmasi dan Refund masuk di M3.
- **C18.** Escrow 7 hari sebagai konstanta; amandemen PRD FFI-17.
- **C19.** Demo disembunyikan dengan flip manual.
- **C20.** Receipt anonim tetap menampilkan nama (hanya pemegang token yang bisa melihat).
- **C21.** Perubahan Bank Account bukan change request Campaign (rekening dipilih per Payout).
- **C22.** Disbursement API ditunda; transfer manual dengan bukti tetap (ADR 0006).
- **C23. Item perluasan:** E1 domain/prefix tautan pendek; E2 dasar legal aturan 180 hari; E3 jendela waktu, batas per Kind, anti-abuse; E4 peran anggota, apakah anggota boleh minta Payout (rekomendasi: tidak); E6 BSP + biaya, model consent; E7 next-intl, slug tetap Indonesia; E8/E9 sub-pertanyaan dari tiketnya.

## Track D: housekeeping (satu PR dokumen di Gelombang 0)

- **Tandai done:** prd-compliance 54 (bac0127); ci-cd 08 (sisa pindah ke go-live-ops 01: stopgap nginx, pensiun kibi-clone); ci-cd 23 dan 25 setelah A2 (catat keputusan "A + reviewer + protection"); ci-cd 10 setelah branch protection.
- **Rapikan dokumen deploy:** header `deploy.yml`, `docs/agents/verification.md`, baris `CLAUDE.md` tentang dispatch → "hanya owner dispatch, owner juga reviewer".
- **Tutup setelah hitungan A1:** campaign-status-transitions 11 (wontfix bila 0); prd-compliance 45 setelah cron jalan; prd-compliance 48 → ready-for-agent pasca-rilis, kecuali A1 menemukan baris key lama.
- **Tiket keputusan tanpa tiket build** (rilis-1-benda 03, 04, 05, 08, 12, 17, 18): tambah baris "Built by:" ke tiket baru.
- **Sapu checkbox:** prd-compliance 17, 18, 29, 31, 34, 37; subject-guard 02, 05.
- **Koreksi bertanggal:** prd-audit research 01/02 dan scorecard rilis-1-benda.
- **Hapus** `SUMOPOD_WEBHOOK_TOKEN` dari `docs/integrasi-sumopod.md` (tidak dibaca kode).

## Gelombang

- **G0 (hari 0–2):** owner A1/A2 di sesi VPS, mulai A3/A4, jawab ronde C. Koordinator: salin rencana, PR housekeeping, tulis semua tiket baru. Builder: P1, P2, A-1, H-1, H-2, H-3a, G-1, H-6. Keluar bila M0 terbukti, C1–C6 terjawab, PR hijau.
- **G1 (hari 2–6):** builder M-a (slot skema), S-0 (setelah ~10-10 + hitungan A1), A-2, F3, A-3, ADR i18n, runbook. Beta publik (B-1) hidup: gladi donasi → Payout → Refund dengan sandbox di domain utama. Satu Deploy di akhir gelombang. Keluar bila produksi memuat semua item pra-M1 dan alur M1 lulus gladi di beta.
- **G2 (M1, lalu 7 hari escrow):** owner A5 → A6. Builder D-1, F2, N-1, H-4, H-5, H-3b, M-b, lalu M-c Xendit dengan kunci sandbox. Keluar bila M1 terbukti dan semua kode M2 ter-deploy sebelum hari ke-7.
- **G3 (M2 → Soft Launch):** owner drill A7. Builder F1 → N-2, F4 → M-e, F5, F6, P3, A-4, A-5, A-6, M-d, V-1, V-2, E1, E9 (email konfirmasi). Owner membuat Trip/Batch nyata ≥3 minggu ke depan. Keluar bila M2 terbukti, Terms/Privacy live, owner menyetujui promosi.
- **G4:** builder E2, E3, E4, E8, E9 (akun penuh), V-3, sisa M-c sampai siap produksi, lalu E5. Owner: kredensial Xendit produksi, onboarding WhatsApp.
- **G5:** builder E6 WhatsApp, lalu **E7 i18n sendirian**, CSP enforce, e2e lengkap. Owner A8. Keluar = **Rilis 1 penuh**.

## Verifikasi per milestone (koordinator tanpa psql)

- **M0:** dump terbaru < 24 jam + salinan offsite + log restore drill; alert uji diterima; cron jobs 200 lalu nol; login di apex; `gh api` menunjukkan proteksi `main` + reviewer `production`.
- **M1:** SHA ter-deploy = SHA Gelombang 1, health 200; screenshot persetujuan `/moderasi` + Campaign publik; email verifikasi diterima, tanpa `mail_not_configured` di log; donasi QRIS owner settle, `/donasi-saya` + Receipt tercetak; `GET /api/admin/reconcile` seimbang dengan Provider Fee sama dengan dashboard Sumopod.
- **M2:** Payout sebelum Usage Report ditolak, sesudahnya diterima; Admin B melihat nomor rekening dan reveal tercatat; Refund 3 Admin + email Donor; `/admin/reconciliation` cocok dengan dashboard; owner menandatangani checklist "tanpa SQL".
- **M3:** hold kursi ditolak di atas batas; Trip Fee settle; Refund sesuai `refund-table.ts`; sertifikat `/sertifikat/<code>` hanya untuk yang hadir; Payout Trip Fee dari panel; VA Xendit terekonsiliasi (`perProviderIsExact`); setiap item perluasan punya tiket done + layar terjangkau + e2e di CI + uji terima owner; `git grep '^\*\*Status:\*\*'` di `.scratch` bersih.

## Risiko utama

- Lead time vendor/legal (KYB Sumopod dan Xendit, Meta, PSE) menentukan tanggal → mulai hari 0, gladi di beta sandbox (B-1).
- Ketujuh item perluasan menambah ~35 hari-builder, dan i18n menyentuh semua halaman → ADR kunci di G1, ekstraksi paling akhir.
- Kode uang baru (reveal, Xendit, refund Donor, anggota tim) selalu review independen sonnet dengan bukti di PR.
- Data produksi hanya di satu host sampai A1 selesai → prioritas pertama.
- Disk 81% → prune + rotasi log di A1.

## Fakta sesi VPS (2026-10-04, terverifikasi)

- A2 GitHub: environment production punya required reviewer andrianm28, branch `main` saja; branch protection `main` mewajibkan check test, build, migrations, ratchet, e2e (github-actions), tanpa force-push/delete, admin bypass; Dependabot alerts, secret scanning, push protection aktif → ci-cd 10, 23, 25 bisa ditutup. H-6 WAJIB mempertahankan job agregat bernama "test".
- A1 backup: backup malam DB produksi + volume uploads, offsite terenkripsi retensi 90 hari; restore drill lulus (4 s, jumlah baris identik) → bahan `docs/runbooks/restore.md`. Restore butuh FIELD_* key yang sama.
- `NEXTAUTH_URL` produksi = apex; domain lama 301 ke apex. H-2 tetap memvalidasi NEXTAUTH_URL di kode. Webhook penyedia didaftarkan di apex.
- Monitoring host: cek /api/health, umur backup, disk 85% ditambahkan. Kanal alert masih rusak (owner memperbaiki).
- Cron jobs (prd-compliance 45) BELUM dipasang: menunggu reminders-skip-demo-campaigns ter-deploy (8 Campaign demo akan memicu pengingat).
- Stopgap nginx `/_next/image` tidak berbahaya (app memakai images.unoptimized), boleh dibiarkan.
- Host juga menjalankan stack lain (tidak disebut di sini) yang tidak boleh disentuh. Disk 84% (owner menangani).
- Hitungan Track D: ADMIN=2, VERIFIER=2 (perlu Admin ke-3); tidak ada role ADMIN/MODERATOR lama tanpa assignment (S-0 aman); SUSPENDED tanpa log = 0 → campaign-status-transitions 11 wontfix; key id hanya enc-k1/hmac-k1 → prd-compliance 48 pasca-rilis; donationBalance>0: 5 user, Rp1.371.884 (keputusan owner menyusul). Hanya hitungan agregat; tidak ada data pribadi dicatat di sini.
