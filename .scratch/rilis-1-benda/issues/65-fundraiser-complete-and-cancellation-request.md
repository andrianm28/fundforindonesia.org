# 65: F2 fundraiser-complete-and-cancellation-request

**Status:** awaiting-merge

**Blocked by:** none (backend `completeCampaign` dan `requestCancellation` sudah ada)

**Ukuran:** S-M

**Catatan:** Layar Fundraiser; tanpa skema.

## Latar

Fundraiser belum punya tombol untuk menandai Campaign Completed atau mengajukan pembatalan; keduanya hanya ada di API.

## Berkas relevan

- `src/lib/campaign-lifecycle.ts` (`completeCampaign` ~baris 1272, `requestCancellation` ~baris 1351)
- `src/app/api/campaigns/[slug]/complete/route.ts`
- `src/app/api/campaigns/[slug]/cancellation-requests/route.ts`
- `src/app/akun/kampanye-saya/page.tsx` dan `src/app/akun/kampanye-saya/[slug]/`

## Acceptance

- [ ] Fundraiser melihat aksi Tandai Selesai pada Campaign yang memenuhi syarat dan menekannya lewat route yang ada
- [ ] Fundraiser dapat mengajukan pembatalan dengan alasan; pengajuan kedua yang masih menunggu ditolak dengan pesan jelas
- [ ] Aksi tidak tampil untuk Campaign yang statusnya tidak memenuhi syarat, dan galat domain ditampilkan
- [ ] Hanya Fundraiser pemilik yang melihat aksi; tes komponen dan satu e2e

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
- 2026-10-30: dikerjakan di claude/project-thread-iou1om-fundraiser-kelola: Tandai Selesai dan Ajukan Pembatalan pada `/akun/kampanye-saya/[slug]` (CampaignCloseActions) lewat route yang ada; galat domain tampil apa adanya; e2e `tests/e2e/fundraiser-edit.spec.ts` ditulis (belum dijalankan lokal, butuh DB; jalan di CI).
- 2026-10-30: PR #301 (commit 3f7c807 perbaikan review; a43203d menggabungkan main setelah #295). Review independen dan CI hijau; merge disetujui owner.
