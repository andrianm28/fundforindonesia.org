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

Terbuka: UI Fundraiser baru ada di panel Campaign (`PayoutSupportingPapers`); `TripPayoutPanel` dan GET payout Trip belum menampilkan catatan, dokumen, dan alasan revisi (API Trip sudah menerima `note`). Review independen sonnet (uang) masih perlu di-dispatch koordinator.
