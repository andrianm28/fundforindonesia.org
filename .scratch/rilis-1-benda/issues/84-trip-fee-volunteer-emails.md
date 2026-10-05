# 84: V-3 trip-fee-volunteer-emails

**Status:** ready-for-agent

**Blocked by:** none; C17 dijawab owner 2026-10-04

**Ukuran:** M

**Catatan:** Email; tanpa skema.

**Keputusan (2026-10-04, ronde C):** C17 email Volunteer (konfirmasi pendaftaran dan Refund Trip Fee) dibangun di M3 (sesuai rekomendasi).

## Latar

Volunteer belum menerima email saat pendaftaran dikonfirmasi atau Refund Trip Fee diproses.

## Berkas relevan

- `src/lib/mail/index.ts`, `src/lib/mail/types.ts`
- `src/lib/volunteer/trip-registrations.test.ts` (alur konfirmasi)
- `src/lib/volunteer/refunds.ts`
- `src/lib/money/refunds.ts`

## Acceptance

- [ ] Volunteer menerima email konfirmasi saat Trip Fee settle dan pendaftaran CONFIRMED
- [ ] Volunteer menerima email saat Refund Trip Fee disetujui dan selesai, sesuai tier `refund-table.ts`
- [ ] Tanpa nomor rekening atau data pribadi lain di isi email; kegagalan kirim tidak membatalkan transaksi
- [ ] Tes untuk tiap templat

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C17 dijawab owner sesuai rekomendasi: email Volunteer masuk M3, bukan sebelumnya. Dikerjakan di Gelombang 4 (V-3). `needs-info` menjadi `ready-for-agent`.
