# 68: N-1 payout-refund-suspension-emails

**Status:** ready-for-agent

**Blocked by:** none (lanjutan `prd-compliance-fase-0-2` 32)

**Ukuran:** M

**Catatan:** Email; tanpa skema. Menyentuh alur uang hanya sebagai pemicu; review independen disarankan.

## Latar

PRD 7.2 meminta email untuk Payout, Refund, dan suspensi. Hanya email verifikasi, receipt, pengingat, transfer, dan hasil verifikasi yang ada; ketiganya belum.

## Berkas relevan

- `src/lib/mail/index.ts`, `src/lib/mail/types.ts`, `src/lib/mail/campaign-transfer.ts` (pola)
- `src/lib/money/payouts.ts`, `src/lib/money/refunds.ts`
- `src/lib/campaign-lifecycle.ts` (`suspendCampaign` ~1497)
- `src/lib/mail/escape-html.ts`

## Acceptance

- [ ] Fundraiser menerima email saat Payout disetujui dan saat selesai
- [ ] Donor menerima email saat Refund selesai atau gagal, tanpa membocorkan nomor rekening
- [ ] Fundraiser menerima email saat Campaign ditangguhkan dan saat dicabut
- [ ] Kegagalan kirim email tidak membatalkan transaksi uang (pola klaim yang sudah ada)
- [ ] Isi email di-escape dan hanya memuat data yang boleh dilihat penerima; tes untuk tiap templat

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
