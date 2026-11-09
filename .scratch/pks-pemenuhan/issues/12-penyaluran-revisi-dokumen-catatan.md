# 12: Penyaluran: minta revisi, dokumen pendukung, catatan

**Blocked by:** 10 (slot skema)

**Status:** done

**What to build:** Pasal 4.5. Pengajuan Payout menerima dokumen pendukung (Document privat) dan catatan tambahan. Admin bisa 'minta revisi' dengan alasan (status baru atau penanda pada REQUESTED), penggalang memperbaiki lalu mengajukan ulang; tidak ada dana yang bergerak selama revisi. Notifikasi + email ke penggalang.

- [x] Test transisi revisi tidak memposting ledger
- [x] Test dokumen hanya bisa dibaca pemilik, Admin
- [ ] Review independen sonnet (uang)

## Catatan 2026-11-09 (builder)

Pilihan desain:

- **Status baru `PayoutStatus.REVISION_REQUESTED`**, bukan penanda. Alur: `DRAFT` -> `REVISION_REQUESTED` (Admin, wajib alasan <= 500 karakter) -> `DRAFT` (Fundraiser mengajukan ulang). `approvePayout`, `recordPayoutBalanceShort`, `completePayout`, dan `failPayout` tidak berubah dan menolak status ini, sehingga tidak ada ledger yang bisa terposting selama revisi. Admin masih boleh `reject` dari `REVISION_REQUESTED` (jalan keluar bila Fundraiser tidak menjawab).
- Kolom baru di `Payout`: `supportingNote` (<= 1000), `revisionReason`, `revisionRequestedById`, `revisionRequestedAt`. Jejak revisi dipertahankan setelah diajukan ulang.
- **Dokumen pendukung** memakai model `Document` privat dengan kolom `payoutId` (pemilik ketiga; CHECK `Document_one_owner` ditulis ulang). Unggah lewat `POST /api/documents` (`payoutId` + `label`), hanya Fundraiser pemohon, hanya saat `DRAFT` atau `REVISION_REQUESTED`. Baca lewat ACL yang ada: pengunggah, pemohon Payout, dan Admin; Verifier tidak.
- Domain: `requestPayoutRevision` dan `resubmitPayout` di `src/lib/money/payouts.ts`; `requestPayout` menerima `note`. Resubmit hanya boleh mengganti catatan dan keterangan; nominal dan rekening tidak (itu permintaan baru setelah yang lama ditolak).
- Notifikasi: inbox `payout_revision` (`notifyPayoutRevision`) dan email `revision_requested` lewat `emailPayoutStatus` (`composeAndSend` -> `sendReportingFailure`, jadi kegagalan masuk antrean `failed-notifications`). Keduanya setelah commit dan tidak bisa membatalkan revisi.
- Rute: `POST /api/admin/payouts/[id]/request-revision` (`withHiddenAssignmentCheck`, 404 literal bagi non-Admin; masuk allowlist `roles-expand-guard`), `POST /api/user/payouts/[id]/resubmit` (satu rute untuk Campaign dan Trip; kepemilikan dinilai di domain di bawah kunci subjek).
- Migrasi `20261111120000_penyaluran_revisi_dokumen_catatan`: `prisma migrate diff` kosong terhadap DB hasil `migrate deploy`; ada tes DB nyata (`src/__tests__/payout-revision-migration.test.ts`, butuh `TEST_DATABASE_URL`).

Terbuka: Review independen sonnet (uang) masih perlu di-dispatch koordinator.

## Catatan 2026-11-09 (perbaikan temuan review independen)

- **UI Trip**: GET `/api/volunteer-trips/[slug]/payouts` kini menyertakan `supportingNote`, `revisionReason`, dan `documents` (ringkasan tanpa path penyimpanan); `TripPayoutPanel` memakai ulang `PayoutSupportingPapers` (unggah saat `DRAFT`/`REVISION_REQUESTED`, daftar, alasan revisi, ajukan ulang) dan punya kolom catatan tambahan pada permintaan baru. Notifikasi sudah menaut ke `/akun/volunteer-trip/<slug>`.
- **Tes subjek Trip** untuk `requestPayoutRevision` dan `resubmitPayout` (kunci `VolunteerTrip ... FOR UPDATE`, pemilik, Trip Suspended).
- **Unggah dokumen Payout**: status dan pemohon dibaca ulang di transaksi yang sama dengan `Document.create`, dengan `SELECT ... FOR UPDATE` pada baris Payout. Keputusan yang commit lebih dulu menolak unggahan (409/404, berkas dihapus); keputusan yang datang belakangan menunggu commit unggahan.
- **Resubmit** oleh non-pemohon (atau pemohon yang bukan lagi Fundraiser subjek) dijawab `PayoutNotFoundError` (404), sama persis dengan Payout yang tidak ada; tidak ada kebocoran keberadaan id. Pemeriksaan pemohon pada baris dilakukan sebelum kunci subjek (`requestedById` tidak berubah).
- **Notifikasi inbox saat revisi**: antrean `failed-notifications` hanya untuk surel (`MailMessage`), bukan baris inbox. Baris inbox `payout_revision` best-effort seperti notifikasi inbox lain di repo; kegagalannya tetap `console.error` (`notification_failed`) dan tidak membatalkan revisi. Surelnya masuk antrean.
- Batas 500 karakter keterangan (dan 1000 catatan) satu konstanta di `src/lib/payout-limits.ts`, dipakai skema zod kedua rute dan `payouts.ts`.
