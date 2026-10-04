# 85: M-c xendit-adapter

**Status:** ready-for-agent

**Blocked by:** 69 (M-b). Kunci sandbox Xendit dari owner (A3) untuk uji akhir; pengembangan memakai mock.

**Ukuran:** XL

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet` dengan bukti diposting di PR. Harus ada di Rilis 1: gerbang F2/F3 butuh dua penyedia.

## Latar

Penyedia kedua: Xendit membawa VA dan e-wallet (keputusan di `18-second-payment-provider.md`, riset di `.scratch/rilis-1-benda/research/18-second-provider.md`). Disbursement API ditunda (C22), transfer manual dengan bukti tetap (ADR 0006).

## Berkas relevan

- `src/lib/payments/types.ts` (`PaymentProvider`)
- `src/lib/payments/index.ts`, `active-provider.ts`, `production-readiness.ts`
- `src/lib/payments/sumopod-provider.ts` dan `sumopod-signature.ts` (pola)
- `src/app/api/webhooks/[provider]/`
- `src/app/campaign/[slug]/donate/page.tsx` (UI metode pembayaran)
- `docs/integrasi-sumopod.md` (padanan dokumen)
- `.env.example` dan `ci/baselines.json` (hanya koordinator)

## Acceptance

- [ ] Verifikasi dulu field fee dan settlement di dokumentasi Xendit; catat temuan di tiket sebelum menulis kode
- [ ] Adapter terdaftar di registry dengan readiness guard; produksi menolak start bila `XENDIT_*` tidak lengkap
- [ ] Callback token diverifikasi constant-time dengan perlindungan anti-replay
- [ ] Charge VA dan e-wallet, dan pemetaan status webhook ke `PaymentStatus`
- [ ] UI memilih metode pembayaran sesuai penyedia aktif
- [ ] Rekonsiliasi per penyedia benar (`perProviderIsExact`) untuk pembayaran Xendit
- [ ] Tes unit, tes kontrak webhook, dan tes Postgres sungguhan; tidak ada kredensial di repo
- [ ] Review independen `sonnet` diposting di PR

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
