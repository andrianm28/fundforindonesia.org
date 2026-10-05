# 79: A-6 finance-recap-and-csv-export

**Status:** ready-for-agent

**Blocked by:** none; C15 dijawab owner 2026-10-04

**Ukuran:** M

**Catatan:** Laporan uang baca-saja; tanpa skema. Review independen `sonnet` karena angka keuangan.

**Keputusan (2026-10-04, ronde C):** C15 rekap per periode x Kind x Campaign plus ekspor CSV (sesuai rekomendasi).

## Latar

PRD section 9 meminta rekap keuangan dan ekspor CSV. Dimensi rekap menunggu keputusan.

## Berkas relevan

- `src/lib/money/impact.ts`
- `src/lib/money/ledger.ts`
- `src/app/admin/page.tsx`
- route dan halaman baru di `src/app/admin/finance/`

## Acceptance

- [ ] Rekap per periode x Kind x Campaign sesuai C15, sama dengan jumlah di buku besar
- [ ] Ekspor CSV dengan kolom yang sama, aman dari injeksi formula (sel diawali `=`, `+`, `-`, `@` dinetralkan)
- [ ] CSV tanpa data pribadi donor
- [ ] Tes terhadap Postgres sungguhan untuk kecocokan total; hanya ADMIN

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C15 dijawab owner sesuai rekomendasi: rekap per periode x Kind x Campaign, plus ekspor CSV. Acceptance di atas sudah memakai bentuk itu. `needs-info` menjadi `ready-for-agent`.
