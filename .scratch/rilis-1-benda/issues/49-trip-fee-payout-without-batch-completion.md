# 49: Payout Trip Fee bisa ditarik sebelum Batch selesai atau jadwal keberangkatan lewat

**Type:** implementation (keamanan, kode uang)

**Status:** in-review

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02, `origin/main` 0f827b1)
menemukan celah pada jalur uang Trip Fee dalam mekanisme payout. Payout Trip Fee
hanya memeriksa apakah Batch/Trip bukan SUSPENDED (`src/lib/subject-guard.ts:257-258`,
`requirePayoutAllowed`), tanpa memastikan Batch sudah COMPLETED atau tanggal 
keberangkatan telah lewat.

Skenario masalah (Fundraiser nakal, Trip ACTIVE, Volunteer sudah bayar):

1. Batch menerima Registration pembayaran Trip Fee.
2. Setelah Escrow Hold 7 hari dari settlement, Fundraiser mengajukan Payout atas
   `TRIP_BALANCE` (trip fee yang telah terkumpul).
3. Payout berhasil karena hanya check `effectiveStatus !== SUSPENDED`.
4. Volunteer yang membatalkan kemudian (dalam jendela refund) dibayar dari pool
   yang sudah dikuras melalui `shortfall` (`src/lib/money/refunds.ts:approveRefund`),
   yakni uang platform yang jadi pihak ketiga atas refund.

Aliran dana menjadi: Volunteer bayar Trip Fee → Fundraiser payout seluruhnya →
Volunteer cancel → Platform bayar refund dari shortfall (beban platform).

## Scope

Putuskan dengan owner:
- Apakah Payout Trip Fee harus menunggu Batch COMPLETED atau tanggal keberangkatan 
  (`batch.startDate`) telah lewat sebelum diizinkan?
- Apakah ada batasan lain, misal tidak boleh menguras pool selagi ada Registration 
  CONFIRMED yang masih bisa di-refund?
- Apakah diperlukan penanda (flag) pada Payment/Payout yang mencegah Payout sebelum 
  kondisi terpenuhi?

Jika ya, update `requirePayoutAllowed` (`src/lib/subject-guard.ts:257`) untuk 
memeriksa state Batch tambahan.

## Acceptance

- Owner memberikan keputusan tentang aturan kapan Payout Trip Fee boleh ditarik.
- Jika ada aturan baru: tes payout menolak sebelum kondisi terpenuhi, lolos setelah.
- Menyentuh kode uang di `src/lib/subject-guard.ts`: review independen `sonnet` wajib.

## Keputusan owner (Dri, 2026-10-02)

Payout Trip Fee hanya boleh untuk dana dari Batch yang sudah `COMPLETED`.
Ditegakkan saat Payout diminta, disetujui, dan diselesaikan, di bawah lock
Trip yang sudah ada. Tanpa flag baru pada Payment/Payout dan tanpa skema baru.

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
