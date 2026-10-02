# 53: completeBatch tidak menangani HOLD; confirmRegistration setelah Batch selesai tidak ditolak

**Type:** implementation (keamanan)

**Status:** needs-triage

**Blocked by:** none

## Why

Audit keamanan menemukan dua celah pada finalisasi Batch: (1) completeBatch tidak mengubah hold yang sudah hangus, meninggalkan registrasi dalam status unclear, dan (2) confirmRegistration bisa dipanggil setelah Batch selesai, menciptakan settlement yang terlambat.

Detail teknis disimpan owner di luar repo publik.

## Scope

- completeBatch menangani hold: release/reject sesuai aturan owner
- confirmRegistration tolak jika Batch sudah COMPLETED

## Acceptance

- Tes: completeBatch mengubah hold sesuai aturan owner
- Tes: confirmRegistration ditolak jika Batch COMPLETED
- Tes: Workflow normal (HOLD → CONFIRMED → COMPLETED) tetap berfungsi
- Menyentuh kode uang: review independen `sonnet` wajib
