# 49: Payout Trip Fee bisa ditarik sebelum Batch selesai atau jadwal keberangkatan lewat

**Type:** implementation (keamanan, kode uang)

**Status:** needs-info

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
