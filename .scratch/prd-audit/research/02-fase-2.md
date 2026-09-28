# 02: Kepatuhan `origin/main` terhadap gerbang Fase 2

Diaudit pada `origin/main` commit `c19f2eb` (Ticket 16 merged), read-only, tanpa
menjalankan test suite. Standar bukti: `.scratch/prd-audit/map.md` — requirement
yang dijalankan pengguna baru ✅ bila ada kode + tes + layar yang menunjuknya;
aturan backend cukup kode + tes; kode tanpa layar = 🟡.

## ⚠️

- **Gerbang Fase 2 tidak lolos pada kedua ukurannya sekaligus.** "Alur Payout
  dan Usage Report berjalan tanpa intervensi basis data": Usage Report tidak
  punya kode sama sekali (`src/lib/campaign-lifecycle.ts:618-621`), dan layar
  Payout (Fundraiser mengajukan, Admin menyetujui/menyelesaikan) tidak ada di
  `main` — hanya API route (`src/app/api/campaigns/[slug]/payouts/route.ts`)
  tanpa satu pun pemanggil `.tsx` non-test (`grep -rl bankAccountId --include="*.tsx" src/` = 0 hasil).
  "Payment dari dua penyedia terekonsiliasi": hanya ada dua nama provider di
  build ini, `mock` dan `sumopod` (`src/lib/payments/provider-names.ts:26`) —
  tidak ada penyedia kedua nyata sama sekali, jadi rekonsiliasi dua penyedia
  secara harfiah mustahil diuji hari ini.
- **Refund hanya separuh dibangun, dan komentarnya sendiri mengakuinya.**
  `src/lib/money/refunds.ts:36` menyatakan eksplisit: "This ticket's own code
  only ever produces REQUESTED and APPROVED -- AWAITING_DONOR_DETAILS,
  PROCESSING, COMPLETED, REJECTED, FAILED stay in the schema's enum ... neither
  of which this ticket builds a route for." Siklus status penuh §7.2 (email
  rekening Donor, tautan bertanda tangan 30 hari, pemeriksaan Verifier, bukti
  transfer) tidak ada kodenya. Plus: tidak ada layar sama sekali untuk membuat
  atau menyetujui Refund (`grep -rl /refunds --include="*.tsx" src/app` non-test
  = 0 hasil).
- **Laporan Dormant Balance 60 hari — yang PRD §7.3 sebut "murah" dan masuk
  rilis pertama — belum ada kodenya sama sekali**, bukan hanya pengalihannya.
  Satu-satunya jejak adalah komentar di `src/lib/scheduled-jobs.ts:48-51` yang
  menyatakan fitur ini belum dibangun. `CONTEXT.md:239-241` sudah mencatat ini
  untuk *pengalihan*-nya, tetapi laporan 60 hari sendiri — item terpisah dan
  lebih murah — juga nol kode, dan tidak disebut terpisah di `CONTEXT.md`.
- **`scorecard.md` (2026-09-27) sudah basi pada beberapa baris** karena ticket
  16 merge di `c19f2eb` (2026-09-28) setelah tanggal scorecard itu ditulis.
  Rincian di bagian "Baris scorecard yang basi" di bawah.

## FFI-07 — Pencairan dana (Payout)

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| Payout dihitung dari Campaign Balance via buku besar setelah Escrow Hold | 🟡 | `src/lib/money/payouts.ts:82-166` (`lockPayoutSubject`, saldo dihitung di bawah lock) | Kode + tes ada, tidak ada layar |
| Bank Account terverifikasi sebagai syarat Payout | 🟡 | `src/lib/money/payouts.ts:158` `bankAccount.ownerId !== requestedById \|\| !bankAccount.verifiedAt` | Backend sudah menegakkan; tidak ada layar pengajuan Payout |
| Persetujuan Admin bukan pemohonnya (dua orang, tahap 1) | 🟡 | `src/lib/money/payouts.ts:343-346` `payout.requestedById === approvedById` ditolak | Kode + tes |
| Admin penyelesai berbeda dari penyetuju (dua orang, tahap 2) | 🟡 | `src/lib/money/payouts.ts:570-576` `payout.approvedById === completedById` ditolak | Kode + tes |
| Layar Fundraiser mengajukan Payout | ❌ | tidak ada `.tsx` non-test yang memanggil `POST /api/campaigns/[slug]/payouts` | Skor `rilis-1-benda/scorecard.md:79`: "the screen is in unmerged PR #94" — masih benar di `origin/main` |
| Layar Admin menyetujui Payout | ❌ | tidak ada `.tsx` non-test yang memanggil `/approve`; tidak ada halaman di `src/app/admin` atau `src/app/moderasi` untuk Payout | Sesuai `rilis-1-benda/map.md:52` |
| Layar Admin menyelesaikan Payout dengan bukti transfer | ❌ | sama seperti di atas; tidak ada `.tsx` untuk `/complete` | Ini langkah yang benar-benar memindahkan uang |
| Pemilih Bank Account pada form Payout | ❌ | `grep -rl bankaccount --include="*.tsx" src/app` hanya mengembalikan `moderasi/rekening/*` dan `akun/rekening/*`, tidak ada di jalur Payout | Ticket 16 (`c19f2eb`) menutup *pembuatan/verifikasi* Bank Account, bukan pemilihnya di form Payout — sesuai catatan map (lihat bagian scorecard basi) |
| Usage Report wajib sebelum Payout berikutnya | ❌ | tidak ada gerbang di kode; lihat baris FFI-07a | |

## FFI-07a — Usage Report

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| Model, route, dan halaman Usage Report | ❌ | tidak ada `model UsageReport` di `prisma/schema.prisma` (grep `^model ` menghasilkan 42 model, tidak satu pun Usage Report); satu-satunya penyebutan adalah komentar di `src/lib/campaign-lifecycle.ts:618-621` dan `src/app/api/admin/scrutiny/route.ts:25` | Sama seperti dicatat `CONTEXT.md:228-230` |
| Gating Payout berikutnya | ❌ | tidak ada implementasi gate | Konsisten dengan tidak adanya model |

## FFI-07b — Suspension

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| Logika Suspension (stop Donation, bekukan Escrow/Balance, tolak Payout) | 🟡 | `src/lib/money/payouts.ts` dan `src/lib/money/escrow.ts` merujuk status suspended lewat `subject-guard.ts`; `src/app/api/campaigns/[slug]/suspension/route.ts` | Kode + tes, tanpa layar |
| Layar Admin menjatuhkan/mencabut Suspension | ❌ | `grep -rl /suspension --include="*.tsx" src/app` non-test = 0 hasil; `src/app/admin/campaigns/page.tsx` hanya berisi tautan `Edit` ke `/campaign/[slug]/edit`, yang **tidak ada** (`src/app/admin/campaigns/page.tsx:111-116`) | Tautan mati dikonfirmasi ulang, sesuai `scorecard.md:113-114` |

## FFI-07c — Manual Contribution

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| Model + jurnal dua orang, tanpa Escrow Hold/fee | 🟡 | `prisma/schema.prisma:1666` `model ManualContribution`; `src/lib/money/manual-contributions.ts:361` kunci baris `Program` `FOR UPDATE` | Kode + tes |
| Layar Admin mencatat Manual Contribution | ❌ | `grep -rl manual-contributions --include="*.tsx" src/app` non-test = 0 hasil | Sesuai `scorecard.md:98` |

## FFI-07d / §7.2 — Refund

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| `createRefund` (REQUESTED), jurnal beku ke Frozen Balance | 🟡 | `src/lib/money/refunds.ts:195-254` | Kode + tes |
| `approveRefund` (APPROVED), posting empat kaki | 🟡 | `src/lib/money/refunds.ts:286-366` | Kode + tes |
| Siklus penuh: AwaitingDonorDetails, Processing, Completed, Rejected, Failed | ❌ | `src/lib/money/refunds.ts:36` — komentar eksplisit menyatakan hanya REQUESTED/APPROVED yang diproduksi | Enum ada di schema (`prisma/schema.prisma:1115-1123`), rute/logikanya tidak |
| Batas per Kind (`zakat`, `wakaf`, `hibah` tidak refund kecuali kegagalan teknis) | ✅ | `src/lib/money/refunds.ts:121-123` `[Kind.ZAKAT]/[Kind.WAKAF]/[Kind.HIBAH]: 'technical failure only'`; ada tes | Cocok dengan keputusan ticket 06 dan §7.2 |
| Layar membuat/menyetujui Refund | ❌ | `grep -rl /refunds --include="*.tsx" src/app` non-test = 0 hasil | |
| Anti-negative Campaign Balance, urutan Escrow→Campaign Balance→platform | 🟡 | `src/lib/money/refunds.ts` (fungsi `sourceFor`, `poolBalanceFor`, baris 83-166) | Kode + tes, tanpa layar |

## §7.3 — Dormant Balance

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| Laporan Campaign ber-Balance >60 hari (masuk rilis pertama per PRD) | ❌ | tidak ditemukan kode laporan; `src/lib/scheduled-jobs.ts:48-51` hanya komentar bahwa fitur belum dibangun | PRD menyebut ini "murah" dan seharusnya sudah ada di Fase 2 — belum |
| Pengalihan Dormant Balance (di luar rilis pertama) | ❌ (memang di luar cakupan) | sama | Sesuai `CONTEXT.md:239-241` |

## Verifikasi Tambahan & Penanda Audit (§9 Anti-penyalahgunaan)

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| Ambang Rp100 juta (verifikasi tambahan) dan Rp500 juta (penanda audit) | ✅ | `src/lib/abuse-thresholds.ts:44-45` `campaignReviewGross: 100_000_000`, `campaignAuditGross: 500_000_000` | Konfigurasi Admin dengan default, ada tes |
| Verifikasi Tambahan tampil ke Verifier | ✅ | `src/app/moderasi/campaigns/[id]/page.tsx:231` heading "Verifikasi Tambahan" pada panel moderasi Campaign yang sudah reachable | Layar sudah ada — dijangkau lewat halaman moderasi Campaign yang sama |
| Layar konfigurasi ambang (abuse-thresholds) untuk Admin | ❌ | `grep -rl abuse-thresholds --include="*.tsx" src/app` non-test = 0 hasil | Backend + API ada (`src/app/api/admin/abuse-thresholds/route.ts`), tidak ada panel |
| Penanda Audit (CampaignAuditMarker) dipasang otomatis | 🟡 | `src/lib/scrutiny.ts` menulis `CampaignAuditMarker`; hanya dipakai library ini | Tidak ada tampilan publik/Admin eksplisit yang dicek dalam audit ini di luar `scrutiny.ts` |

## FFI-18 — Penyedia pembayaran ganda

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| Antarmuka `PaymentProvider` netral penyedia | ✅ | `src/lib/payments/types.ts`, `src/lib/payments/index.ts` | Sudah dirancang provider-agnostic |
| Penyedia kedua (Midtrans/Xendit/DOKU/Stripe) dengan VA, e-wallet, disbursement | ❌ | `src/lib/payments/provider-names.ts:26` `PAYMENT_PROVIDER_NAMES = ['mock', 'sumopod']` — tidak ada penyedia kedua nyata | Ticket 18 (`rilis-1-benda/issues/18-second-payment-provider.md`) masih **open**, belum ada penyedia yang dipilih |
| Admin mengaktifkan penyedia/metode dari dashboard | ❌ | Pemilihan provider lewat env var `PAYMENT_PROVIDER` (`src/lib/payments/index.ts:95`), bukan panel Admin | Tidak match FFI-18 "dari dashboard" |
| Rekonsiliasi per penyedia | 🟡 | `src/app/api/admin/reconcile/route.ts` menghitung `providerBalances` per penyedia | Kode ada (untuk `sumopod`/`mock` saja), tidak ada layar (`grep -rl reconcile --include="*.tsx" src/app` non-test = 0 hasil di luar teks tak terkait pada halaman Impact) |

## §8 — Alur pengguna (galang dana: Active → Share → Donation → Payout → Usage Report → Payout)

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| Loop Payout ⇄ Usage Report berjalan tanpa `psql` | ❌ | Gabungan temuan FFI-07/07a di atas | Loop putus di kedua ujung: tidak ada layar Payout, tidak ada Usage Report sama sekali |
| Suspension/Cancelled/Expired lifecycle di kode | 🟡 | `src/lib/campaign-lifecycle.ts` | Backend lengkap dan teruji; layar aksi Admin (Suspend/Cancel-approve) tidak ada, lihat FFI-07b |

## §9 — Non-fungsional, kepatuhan, teknis (baris yang relevan Fase 2)

| Requirement | Status | Evidence | Note |
| --- | --- | --- | --- |
| Konkurensi: kunci baris Campaign/Trip pada Payout, Refund, Manual Contribution, pelepasan Escrow | ✅ | `src/lib/subject-guard.ts` (`lockAndLoad`), dipakai `payouts.ts:92,389`, `escrow.ts:234`, `manual-contributions.ts:361`, `refunds.ts:209` | Pola konsisten dan terpusat, dengan tes |
| Audit trail (Payout, Suspension, Refund, Manual Contribution tercatat) | 🟡 | model-model punya `requestedById`/`approvedById`/`completedById` dsb. di schema | Tercatat di DB; tidak ada layar untuk membacanya sebagai jejak audit terpisah |
| Rekonsiliasi harian manual (Sumopod) | 🟡 | `src/app/api/admin/reconcile/route.ts` | Backend lengkap; tidak ada layar, jadi "manual" tidak bisa dilakukan Admin lewat produk hari ini |
| Ekspor laporan penghimpunan/penyaluran per Campaign | ❌ | tidak ditemukan endpoint/kode ekspor | |
| Pengingat 30 hari sebelum Kind Authorisation habis | 🟡 (dikoreksi koordinator) | `expiringWindows` di `src/lib/collecting-entity.ts:136` (default `days = 30`) dengan tes `src/lib/collecting-entity.test.ts`; `src/lib/scheduled-jobs.ts` sendiri tidak punya job terjadwal yang memanggilnya | Semula ditandai ❌ berdasar grep ke `scheduled-jobs.ts` saja; kode dan tes fungsi pengingatnya sendiri memang ada, hanya belum dikonfirmasi dipanggil sebagai job terjadwal atau ditampilkan di layar — jadi 🟡, bukan ❌. Di luar cakupan tiket, dicatat sebagai temuan tambahan; verifikasi lanjut disarankan pada audit workflow/tiket 05 |

## §10 — Model bisnis

Tidak ada requirement khusus Fase 2 di §10 yang berbeda dari status Fase 1
(Platform Fee, dsb.) selain Refund/Manual Contribution yang sudah dibahas di
atas. Tidak ada temuan tambahan.

## Baris `rilis-1-benda/scorecard.md` yang sudah basi

Scorecard ditulis 2026-09-27; ticket 16 merge di `c19f2eb` pada 2026-09-28.

- `scorecard.md:66` ("Memeriksa rekening tujuan — no code at all —
  `bankAccount.create` exists nowhere") — **basi**. `bankAccount.create` kini
  ada di `src/app/akun/rekening/BankAccountRegister.tsx` dan alur verifikasi
  Verifier ada di `src/app/moderasi/rekening/page.tsx` + `DecidePanel.tsx`.
  Verifier — 4 dari 5/8 job sekarang harus naik menjadi 5 (job ini reachable).
- `scorecard.md:69` ("The last row is ticket 01 ... never read as a measure of
  anything") — bagian pertamanya basi untuk alasan yang sama.
- `rilis-1-benda/map.md:16` (skor per role per 2026-09-27, termasuk "Fundraiser
  2 of 5") — belum berubah untuk Fundraiser karena Payout tetap tidak
  reachable (lihat FFI-07 di atas), tetapi baris Verifier di ringkasan yang
  sama juga perlu diperbarui mengikuti poin di atas.
- **Tidak basi, masih akurat**: baris Admin (`scorecard.md:85-107`, 2 dari 13)
  — tidak satu pun dari sepuluh baris "code but no screen" berubah oleh
  ticket 16; Payout tetap tidak punya layar Admin sama sekali (dikonfirmasi
  ulang di atas).
- **Tidak basi**: catatan `rilis-1-benda/map.md:84-106` ("Ticket 16 closes one
  of the two blockers, not the blocker") — dikonfirmasi ulang di audit ini:
  ticket 16 menutup pembuatan/verifikasi akun, tapi pemilih rekening pada form
  Payout dan layar Payout itu sendiri masih tidak ada di `origin/main`.

## Verdict gerbang Fase 2

**Tidak siap kode, dan tidak siap luncur.** Kedua ukuran eksplisit gerbang gagal:

1. *"Alur Payout dan Usage Report berjalan tanpa intervensi basis data"* — gagal
   di kedua sisi: tidak ada layar Payout sama sekali (Fundraiser mengajukan,
   Admin menyetujui, Admin menyelesaikan), dan Usage Report tidak punya kode
   sama sekali.
2. *"Payment dari dua penyedia terekonsiliasi"* — gagal: hanya ada satu
   penyedia pembayaran nyata (`sumopod`) di build ini; tidak ada penyedia kedua
   untuk direkonsiliasikan dengannya.

**Daftar terpendek yang memblokir gerbang** (kode, bisa dikerjakan agent):

1. Layar Payout: form pengajuan Fundraiser (dengan pemilih Bank Account),
   panel Admin menyetujui, panel Admin menyelesaikan dengan bukti transfer.
   (Terkait PR #94 yang belum merge; ticket 16 sudah membuka satu dari dua
   pemblokirnya.)
2. Usage Report: model, route, form Fundraiser, tampilan publik di halaman
   Campaign, dan gating Payout berikutnya — modul yang benar-benar nol kode.
3. Penyedia pembayaran kedua yang nyata (ticket 18 masih *open*, perlu
   keputusan produk dulu sebelum bisa jadi tiket implementasi) — tanpa ini,
   syarat "dua penyedia terekonsiliasi" secara harfiah tidak bisa dipenuhi.
4. Layar Refund (create + approve minimal) dan penyelesaian siklus statusnya,
   atau keputusan eksplisit untuk mempersempit cakupan Refund yang dikirim ke
   produksi lebih dulu.
5. Layar Suspension/Cancellation/Manual Contribution di sisi Admin — kode
   backend sudah ada dan teruji, hanya perlu UI.

**Siap luncur** (langkah owner, di luar kode): keputusan produk pada
ticket 18 (penyedia kedua mana), keputusan cakupan Refund yang dikirim ke
produksi pertama kali, dan verifikasi manual bahwa `SUMOPOD_BASE_URL` produksi
sudah dikonfirmasi (dicatat sebagai "belum dikonfirmasi" di
`docs/integrasi-sumopod.md:10`).

## Catatan ketidakpastian

- Pengingat 30 hari Kind Authorisation sebelum habis (§9 baris Kepatuhan)
  ditandai ❌ berdasarkan tidak ditemukannya job terkait di
  `src/lib/scheduled-jobs.ts`, tetapi pencarian ini tidak menyisir seluruh
  `src/lib/` — kemungkinan ada di modul lain yang tidak diberi nama
  eksplisit "kind-authorisation" atau "reminder"; perlu grep lanjutan sebelum
  dijadikan tiket.
- "Layar konfigurasi ambang similarity/threshold Admin lain" (Platform Fee,
  Escrow Hold override per Category/Campaign) tidak diaudit detail di sini
  karena FFI-17 nominal masuk Fase 1, bukan Fase 2 — disebutkan sekilas untuk
  konteks reconcile saja.
