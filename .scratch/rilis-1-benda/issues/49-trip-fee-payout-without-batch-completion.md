# 49: Payout Trip Fee bisa ditarik sebelum Batch selesai atau jadwal keberangkatan lewat

**Type:** implementation (keamanan, kode uang)

**Status:** awaiting-merge

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02) menemukan celah pada jalur uang Trip Fee: Payout Trip Fee tidak disyaratkan menunggu Batch selesai atau jadwal keberangkatan lewat, sehingga Refund Volunteer berikutnya bisa berbeban pada platform.

Detail teknis eksposur disimpan owner di luar repo publik; lihat PR #176 untuk perbaikan.

## Scope

Keputusan sudah diambil (lihat "Keputusan owner" di bawah); bagian ini mencatat keadaan akhir:

- Payout Trip Fee hanya boleh atas dana Batch `COMPLETED`, sebagai plafon per Trip,
  bukan larangan seluruh Trip. Tidak menunggu `batch.startDate`.
- Dana Batch lain yang masih bisa di-refund (OPEN, CLOSED, CANCELLED) tertahan.
- Tanpa flag baru pada Payment/Payout dan tanpa skema baru.
- Kode ada di `src/lib/money/trip-payout-funds.ts`, dipanggil dari `requestPayout` dan
  `approvePayout` (`src/lib/money/payouts.ts`). `requirePayoutAllowed`
  (`src/lib/subject-guard.ts`) tidak diubah.
- Perubahan kontrak API tambahan (tidak diminta tiket asli): GET
  `/api/volunteer-trips/[slug]/payouts` kini mengembalikan field `withdrawable`;
  dites di `src/app/api/volunteer-trips/[slug]/payouts/route.test.ts`.
- Guard: `src/lib/money/trip-balance-attribution.test.ts` memastikan tiap penulis
  entri `TRIP_BALANCE` selain leg Payout mengisi `paymentId` atau `refundId`; entri tanpa
  keduanya gugur dari INNER JOIN dan diam-diam tidak dihitung tertahan.

## Acceptance

- Owner memberikan keputusan tentang aturan kapan Payout Trip Fee boleh ditarik.
- Jika ada aturan baru: tes payout menolak sebelum kondisi terpenuhi, lolos setelah.
- Menyentuh kode uang di `src/lib/subject-guard.ts`: review independen `sonnet` wajib.

## Keputusan owner (Dri, 2026-10-02)

Payout Trip Fee hanya boleh untuk dana dari Batch yang sudah `COMPLETED`.
Ditegakkan saat Payout diminta dan disetujui, di bawah lock Trip yang sudah
ada. Tanpa flag baru pada Payment/Payout dan tanpa skema baru.

**Keputusan koordinator, MENUNGGU KONFIRMASI OWNER (bukan keputusan owner asli):**
penyelesaian Payout (`completePayout`) sengaja tidak dicek. Keputusan owner di atas
menyebut "diselesaikan"; pengecualian ini diambil dari temuan review PR #176
(2026-10-02) karena debit sudah terjadi saat approve. Owner perlu mengonfirmasi atau
membatalkannya.

### Pilihan desain dan alasannya

Saldo dipegang **per Trip** (`TRIP_BALANCE`, `ESCROW_HOLD` ber-`volunteerTripId`),
bukan per Batch. Tetapi tiap entri buku besar Trip Fee bisa ditelusuri ke Batch
lewat `Payment.registrationId -> Registration.batchId` (untuk leg Refund lewat
`Refund.paymentId`). Karena itu dipilih opsi **plafon**, bukan larangan seluruh Trip:

    dapat dicairkan = TRIP_BALANCE - max(0, saldo bersih TRIP_BALANCE Batch yang bukan COMPLETED)

Leg Payout tidak milik Batch mana pun, jadi tidak ikut bagian "tertahan"; itu
yang membuat pengurangan benar. Alasan tidak memilih "tidak boleh ada Batch OPEN
dengan Registration live": Trip dengan Batch kedua yang masih terbuka akan
mengunci dana Batch pertama yang sudah selesai, padahal tidak ada Volunteer yang
bisa me-refund-nya. Plafon juga otomatis menahan sisa Batch `CANCELLED` (Batch
itu tidak pernah `COMPLETED`; sisanya nol bila semua Refund penuh dibayar), sisi
aman.

- Kode: `src/lib/money/trip-payout-funds.ts` (`tripHeldBalance`,
  `tripWithdrawableBalance`, `requireTripFundsFromCompletedBatches`), dipanggil
  dari `requestPayout` dan `approvePayout` saja, hanya untuk subject Trip.
  **`completePayout` sengaja tanpa cek ini** (temuan review PR #176, 2026-10-02):
  debit Payout sudah terjadi saat approve, jadi uangnya sudah keluar dari
  `TRIP_BALANCE`. Cek di completion tidak menambah proteksi; ia hanya bisa
  memblokir pencatatan bukti transfer untuk uang yang sudah keluar. Nilai
  `NaN` atau tak-finite dari pembacaan dana tertahan melempar error, tidak
  dibulatkan menjadi 0.
- Error baru `TripPayoutFundsNotCompletedError` (`TRIP_PAYOUT_FUNDS_NOT_COMPLETED`,
  409) dengan pesan Indonesia yang menyebut jumlah yang bisa dicairkan.
  `requirePayoutAllowed` (status SUSPENDED) tidak diubah.
- `GET /api/volunteer-trips/[slug]/payouts` kini juga mengembalikan `withdrawable`.
  Catatan: belum ada layar Payout Fundraiser untuk Trip (hanya API dan layar
  Campaign); pesan alasan penolakan tampil lewat respons error API. Layar Trip
  masih perlu tiket sendiri.
- Canary tidak disentuh: `BankAccountNotEligibleError` di `payouts.ts` tetap 6,
  `platformFeePortionFor` 3, `requireRefundAllowedForKind` 3. Jalur Campaign tidak berubah.
- Tes: `src/lib/money/payouts.test.ts` (blok ticket 49),
  `src/__tests__/integration/trip-payout-after-completion.test.ts` (Postgres
  sungguhan: sebelum/sesudah complete, Batch campuran, sisa Refund sebagian,
  race Payout vs `cancelBatch`, race Payout vs `completeBatch`, dua approval
  bersamaan), plus Batch CANCELLED (termasuk sisa Refund sebagian) dan CLOSED
  yang tertahan, approve setelah `cancelBatch`, dan Payout APPROVED yang tetap
  bisa di-complete walau Batch lain OPEN atau CANCELLED menahan dana. Seed
  memakai `Payment.escrowReleasedAt` terisi, sehingga Refund men-debit
  `TRIP_BALANCE`; pada race cancel, urutan cancel-dulu menolak dengan
  `InsufficientBalanceError`, request-dulu dengan `TripPayoutFundsNotCompletedError`.

## Comments

- 2026-10-02: awaiting-merge. PR #176, commit eba566a (kode dan dokumen tindak lanjut review dua sumbu; sebelumnya 7e2077b). Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
