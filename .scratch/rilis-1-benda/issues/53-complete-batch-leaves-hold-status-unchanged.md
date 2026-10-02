# 53: completeBatch membiarkan HOLD tetap HOLD; confirmRegistration tidak memeriksa status Batch

**Type:** implementation (keamanan)

**Status:** needs-triage

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02, `origin/main` 0f827b1)
menemukan celah pada finalisasi Batch dan registrasi yang memungkinkan settlement
terlambat:

1. **completeBatch tidak mengubah HOLD**: Ketika `completeBatch` dipanggil
   (`src/lib/volunteer/trip.ts:613-621`), hanya Registration CONFIRMED yang
   diubah status ke COMPLETED. Registration HOLD tetap HOLD, tidak pernah
   otomatis di-release atau di-confirm. Ini menyebabkan Volunteer dengan HOLD
   tidak jelas nasibnya dan tidak bisa melakukan aksi lebih lanjut.

2. **confirmRegistration tidak memeriksa status Batch**: Fungsi `confirmRegistration`
   (`src/lib/volunteer/trip.ts:936` area `updateMany`) tidak memeriksa apakah Batch
   sudah COMPLETED. Jika `confirmRegistration` dipanggil setelah `completeBatch`,
   settlement terlambat bisa mengubah HOLD menjadi CONFIRMED setelah tanggal
   keberangkatan, menciptakan inkonsistensi.

## Scope

- **completeBatch** (`src/lib/volunteer/trip.ts:613-621`):
  - Setelah menyelesaikan Registration CONFIRMED, handle Registration HOLD:
    - Opsi 1: Release (delete) HOLD yang sudah hangus atau belum dibayar.
    - Opsi 2: Reject (set status ke REJECTED dengan alasan "Batch selesai, hold hangus").
    - Pilih dengan owner.
  - Gunakan `updateMany` untuk batch update, bukan loop.

- **confirmRegistration** (`src/lib/volunteer/trip.ts:936`):
  - Tambahkan guard: jika Batch sudah COMPLETED, tolak dengan error deskriptif.
  - Check dilakukan di bawah lock, sebelum `updateMany`.

## Acceptance

- Tes: `completeBatch` mengubah atau menghapus HOLD sesuai aturan yang ditentukan.
- Tes: `confirmRegistration` ditolak jika Batch COMPLETED.
- Tes: Workflow normal (HOLD → CONFIRMED → COMPLETED) tidak terpengaruh.
- Menyentuh kode uang di `src/lib/volunteer/trip.ts`: review independen `sonnet` wajib.
