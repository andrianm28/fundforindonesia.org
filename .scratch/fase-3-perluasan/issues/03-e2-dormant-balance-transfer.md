# 03: E2 dormant-balance-transfer

**Status:** needs-info

**Blocked by:** 77 (A-4 admin-campaign-transfers-screen); cron jobs A1-7 terpasang (menunggu reminders-skip-demo-campaigns); aturan legal dari counsel (A4)

**Ukuran:** M, skema

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet` dengan bukti diposting di PR. Skema: satu PR skema pada satu waktu.

**Prasyarat:** Cron A1 (A1-7), layar transfer A-4 (77), dan dasar legal aturan 180 hari.

**Menunggu keputusan:** C23 (E2). Apa dasar legal aturan 180 hari tanpa Payout dan tanpa tanggapan atas tiga pengingat sebelum saldo dialihkan? (rekomendasi: counsel memastikan dasarnya sebelum kode pengalihan ditulis)

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
