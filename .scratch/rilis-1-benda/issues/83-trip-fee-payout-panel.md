# 83: V-2 trip-fee-payout-panel

**Status:** done

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

- [x] Panel Payout di layar kelola Trip: saldo yang bisa ditarik, pilih Bank Account terverifikasi, ajukan Payout
- [x] Empty state tanpa rekening memuat tautan ke `/akun/rekening` dan kalimat pembeda 'belum pernah menambahkan' versus 'ada yang ditolak'
- [x] Panel tidak pernah menerima atau menampilkan nomor rekening (hanya kode bank dan nama akun)
- [x] Payout ditolak bila dana belum dari Batch selesai (galat domain tampil)
- [ ] Tes komponen (selesai; e2e Playwright tidak praktis di container, tidak dibuat); review independen `sonnet` diposting di PR (belum, tugas koordinator)

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
- 2026-10-30: dibangun. `TripPayoutPanel` (klon `CampaignPayoutPanel`) di `src/app/akun/volunteer-trip/_components/`, dipasang di halaman kelola Trip. GET `/api/volunteer-trips/[slug]/payouts` ditambah `payouts`, `bankAccounts` (hanya id, kode bank, nama akun; tanpa nomor) dan `hasUnverifiedBankAccount` secara aditif; POST tidak diubah. Hanya tes komponen dan route; e2e Playwright tidak dibuat (tidak praktis di container). Review independen `sonnet` masih harus diposting di PR oleh koordinator.
