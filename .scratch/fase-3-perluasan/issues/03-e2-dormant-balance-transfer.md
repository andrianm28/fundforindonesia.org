# 03: E2 dormant-balance-transfer

**Status:** needs-info

**Blocked by:** 77 (A-4 admin-campaign-transfers-screen); cron jobs terpasang (selesai 2026-10-04); aturan legal dari counsel (A4)

**Ukuran:** M, skema

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet` dengan bukti diposting di PR. Skema: satu PR skema pada satu waktu.

**Prasyarat:** Cron A1 (A1-7), layar transfer A-4 (77), dan dasar legal aturan 180 hari.

**Menunggu:** konfirmasi counsel atas dasar legal aturan 180 hari (A4). Keputusan owner 2026-10-04 (ronde C): dibangun setelah counsel konfirmasi; pelacakan pengingat boleh dibangun lebih dulu.

## Latar

Pengalihan Dormant Balance setelah 180 hari: tiga pengingat, predikat, layar transfer, notifikasi Donor. Laporan 60 hari dan Campaign Transfer yang ada tetap berjalan; yang belum ada adalah pelacakan pengingat dan pengalihannya.

## Berkas relevan

- `.scratch/prd-compliance-fase-0-2/issues/37-dormant-balance-report.md` (kotak 2)
- `src/lib/money/dormant-balances.ts`
- `CONTEXT.md` (Dormant Balance); PRD §7.3
- .scratch/rilis-1-benda/issues/77-admin-campaign-transfers-screen.md

## Acceptance

- [ ] Dasar legal tercatat di tiket sebelum kode
- [ ] Pelacakan tiga pengingat dan predikat 180 hari
- [ ] Pengalihan lewat Campaign Transfer dengan persetujuan Admin; notifikasi Donor
- [ ] Tes race real-DB dan e2e

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.

- 2026-10-04 (ronde C): E2 dijawab owner, menyimpang dari rekomendasi: bagian pengalihan 180 hari dibangun **setelah counsel mengonfirmasi** dasar legalnya, tetapi **pelacakan pengingat boleh dibangun lebih dulu**. Status tetap `needs-info` karena konfirmasi counsel belum ada. Bila pelacakan pengingat mau dikerjakan lebih dulu, pecah menjadi tiket sendiri (tanpa kode pengalihan) saat counsel masih menunggu. Pemblokir cron A1-7 sudah selesai (cron terpasang 2026-10-04).
