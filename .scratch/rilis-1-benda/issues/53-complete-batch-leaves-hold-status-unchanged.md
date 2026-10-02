# 53: completeBatch membiarkan HOLD tetap HOLD; confirmRegistration tidak memeriksa status Batch

**Type:** implementation (keamanan)

**Status:** done (PR #178, 7f71c49)

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02) menemukan celah pada finalisasi Batch: Registration HOLD tidak ditangani saat Batch diselesaikan, dan settlement terlambat bisa mengonfirmasi Registration pada Batch yang sudah selesai, menciptakan inkonsistensi.

Detail teknis eksposur disimpan owner di luar repo publik; lihat PR #178 untuk perbaikan.

## Scope

- **completeBatch** (`src/lib/volunteer/trip.ts`):
  - Setelah menyelesaikan Registration CONFIRMED, setiap Registration HOLD pada Batch menjadi EXPIRED lewat satu `updateMany` (bukan loop), dilewati bila tidak ada HOLD. Pembayaran susulan di-refund penuh lewat `refundLateSettlement`.
  - ~~Opsi 1: delete HOLD~~ (superseded).
  - ~~Opsi 2: set status ke REJECTED~~ (superseded; status itu tidak ada di enum Registration).

- **confirmRegistration** (`src/lib/volunteer/trip.ts`):
  - Tidak menolak dengan error dan tidak mengambil lock sendiri. Hasilnya `outcome`: `'lapsed'` (Registration sudah EXPIRED, atau HOLD lama di Batch COMPLETED) atau `'cancelled'` (sudah CANCELLED, atau HOLD lama di Batch CANCELLED); keduanya di-refund penuh.
  - Penjaga race dengan `completeBatch` adalah CAS `updateMany WHERE status = HOLD`, yang WHERE-nya dievaluasi ulang setelah menunggu row lock. Cek status Batch hanya defense-in-depth untuk baris lama.
  - ~~Tolak dengan error deskriptif di bawah lock bila Batch COMPLETED~~ (superseded).

- Batch CANCELLED tercakup: HOLD lama di Batch itu menjadi CANCELLED dengan outcome `cancelled`, sama seperti `cancelBatch`.

## Acceptance

- Tes: `completeBatch` mengubah setiap HOLD menjadi EXPIRED dan tidak menyentuh CONFIRMED/CANCELLED; tanpa HOLD, tidak ada `updateMany` yang dijalankan.
- Tes: `confirmRegistration` mengembalikan `lapsed` untuk Batch COMPLETED dan `cancelled` untuk Batch CANCELLED, tanpa error, dan pembayarannya di-refund penuh.
- Tes: race `completeBatch` vs settlement deterministik (settlement menunggu row lock, lalu mendapati EXPIRED dan mengembalikan `lapsed`).
- Tes: Workflow normal (HOLD -> CONFIRMED -> COMPLETED) tidak terpengaruh.
- Menyentuh kode uang di `src/lib/volunteer/trip.ts`: review independen `sonnet` wajib.

## Implementation notes

- `completeBatch` sets every HOLD on the Batch to EXPIRED (not delete/reject: no
  REJECTED status exists, and EXPIRED already routes a late settlement to
  `refundLateSettlement` 'lapsed settlement', full refund). One `updateMany`,
  under the Trip -> Batch -> Registration lock it already holds.
- `confirmRegistration` still takes no lock; a HOLD found on a non-OPEN Batch
  (legacy row) lapses instead of confirming, and its write waits on the row lock
  of a concurrent `completeBatch`.
- Tests: trip-batches.test.ts, trip-registrations.test.ts, and real-Postgres
  cases in integration/volunteer-registration-concurrency.test.ts.

## Keputusan review PR #178

- Race `completeBatch` vs settlement dijaga CAS `updateMany WHERE status=HOLD` di `confirmRegistration`; cek status Batch hanya defense-in-depth untuk baris lama.
- Tes race deterministik (completeBatch dijeda setelah lock Registration, settlement terbukti menunggu lock) membunuh mutan tanpa `updateMany` EXPIRE.
- HOLD lama di Batch CANCELLED kini menjadi CANCELLED dan outcome `cancelled` (Refund `late settlement`, sama dengan `cancelBatch`); di Batch COMPLETED tetap `lapsed`.
- UI Volunteer sudah benar: EXPIRED tampil "Kedaluwarsa" tanpa hitung mundur/tombol batal/tautan bayar; tes ditambahkan.

## Comments

- 2026-10-02: keputusan owner (Dri): HOLD yang tersisa saat Batch COMPLETED menjadi EXPIRED, saat CANCELLED menjadi CANCELLED; pembayaran susulan di-refund penuh lewat late settlement; REJECTED tidak dipakai karena tidak ada di enum Registration. Dicatat di CONTEXT.md.

- 2026-10-02: awaiting-merge. PR #178, commit d3a2ece. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
- 2026-10-02: ditriase retroaktif oleh koordinator (gap alur: builder di-dispatch saat masih needs-triage); owner menyetujui cakupan lewat "ya" 2026-10-02. Dibangun di PR #178.
- 2026-10-02: done. Merge ke main sebagai 7f71c49.
