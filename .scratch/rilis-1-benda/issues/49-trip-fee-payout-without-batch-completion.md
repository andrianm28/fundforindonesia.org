# 49: Payout Trip Fee bisa ditarik sebelum Batch selesai atau jadwal keberangkatan lewat

**Type:** implementation (keamanan, kode uang)

**Status:** ready-for-agent

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02, `origin/main` 0f827b1)
menemukan celah pada jalur uang Trip Fee dalam mekanisme payout. Payout Trip Fee
hanya memeriksa apakah Batch/Trip bukan SUSPENDED (`src/lib/subject-guard.ts:257-258`,
`requirePayoutAllowed`), tanpa memastikan Batch sudah COMPLETED atau tanggal 
keberangkatan telah lewat.

Dampak (setingkat peran): dana Trip Fee dapat ditarik Fundraiser sebelum Batch
selesai, sehingga refund Volunteer yang batal belakangan ditanggung platform.
Rincian alur langkah demi langkah tidak ditulis di sini.

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

## Comments

- 2026-10-02: ditriase retroaktif oleh koordinator (gap alur: builder di-dispatch saat masih needs-triage); owner menyetujui cakupan lewat "ya" 2026-10-02. Dibangun di PR #176.
