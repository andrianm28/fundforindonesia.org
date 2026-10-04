# 73: F5 fundraiser-donation-list

**Status:** ready-for-agent

**Blocked by:** none

**Ukuran:** S

**Catatan:** Layar baca-saja; tanpa skema. Aman anonimitas: donasi anonim tidak membuka identitas.

## Latar

Fundraiser belum punya daftar donasi untuk Campaign-nya.

## Berkas relevan

- `src/app/api/campaigns/[slug]/donations/route.ts`
- `src/lib/donor-anonymisation.ts`
- `src/app/akun/kampanye-saya/[slug]/`
- `src/lib/donations.ts`

## Acceptance

- [ ] Fundraiser pemilik melihat daftar donasi settled Campaign-nya (jumlah, waktu, nama tampilan)
- [ ] Donasi anonim tampil sebagai anonim; tidak ada email, kontak, atau token receipt di respons
- [ ] Non-pemilik mendapat 404; tes untuk keduanya
- [ ] Paginasi dan tes komponen

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
