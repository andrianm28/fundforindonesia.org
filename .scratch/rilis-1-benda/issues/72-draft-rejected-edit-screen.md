# 72: F4 draft-rejected-edit-screen

**Status:** ready-for-agent

**Blocked by:** none. Tidak boleh berjalan bersamaan dengan M-e (81); rencana menyebut batasan ini tetapi bagian lanjutannya terpotong.

**Ukuran:** M

**Catatan:** Layar; tanpa skema.

## Latar

Campaign Draft atau Rejected tidak bisa diedit dari layar, dan Active tidak punya layar untuk mengajukan perubahan target/tenggat. Tautan Edit di daftar Admin mengarah ke halaman yang tidak ada. Perubahan Bank Account bukan change request Campaign (C21: rekening dipilih per Payout).

## Berkas relevan

- `src/app/admin/campaigns/page.tsx:112` (`/campaign/${slug}/edit`, rute mati)
- `src/app/campaign/create`
- `src/lib/campaign-lifecycle.ts` (`requestCampaignChange` ~1148, `submitCampaign` ~523)
- `src/app/api/campaigns/[slug]/route.ts` (PATCH)
- `src/app/akun/kampanye-saya/[slug]/`

## Acceptance

- [ ] Layar edit untuk Campaign Draft dan Rejected, memakai route PATCH yang ada
- [ ] Layar pengajuan change request target/tenggat untuk Campaign Active, memakai `requestCampaignChange`
- [ ] Tautan di `src/app/admin/campaigns/page.tsx` tidak lagi mengarah ke 404 (arahkan ke layar yang benar atau hapus)
- [ ] Fundraiser lain dan non-pemilik mendapat 404
- [ ] Tes komponen dan e2e

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
