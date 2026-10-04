# 83: V-2 trip-fee-payout-panel

**Status:** ready-for-agent

**Blocked by:** none (route Payout Trip Fee dan `trip-payout-funds` sudah ada)

**Ukuran:** M

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet` dengan bukti diposting di PR.

## Latar

Fundraiser Volunteer Trip belum punya panel untuk meminta Payout Trip Fee; route-nya sudah ada. Ini juga tiket build untuk keputusan `17-the-picker-exists...` (klon panel Campaign untuk Trip, dan tautan `/akun/rekening` di empty state).

## Berkas relevan

- `src/app/api/volunteer-trips/[slug]/payouts/route.ts`
- `src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.ts`, `complete/route.ts`
- `src/lib/money/trip-payout-funds.ts` (`tripWithdrawableBalance`)
- `src/components/campaign/CampaignPayoutPanel.tsx` (acuan klon)
- `src/app/akun/volunteer-trip/[slug]/page.tsx`
- `src/app/akun/rekening/page.tsx`

## Acceptance

- [ ] Panel Payout di layar kelola Trip: saldo yang bisa ditarik, pilih Bank Account terverifikasi, ajukan Payout
- [ ] Empty state tanpa rekening memuat tautan ke `/akun/rekening` dan kalimat pembeda 'belum pernah menambahkan' versus 'ada yang ditolak'
- [ ] Panel tidak pernah menerima atau menampilkan nomor rekening (hanya kode bank dan nama akun)
- [ ] Payout ditolak bila dana belum dari Batch selesai (galat domain tampil)
- [ ] Tes komponen dan e2e; review independen `sonnet` diposting di PR

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
