# 02: Seberapa patuh `main` terhadap PRD untuk gerbang Fase 2?

**Type:** research

**Status:** resolved

**Findings:** `.scratch/prd-audit/research/02-fase-2.md`

**Blocked by:** —

## Question

Untuk setiap requirement cakupan Fase 2 (§11), ditambah §7.2 Refund, §7.3 Dormant
Balance, §8 alur pengguna, §9 non-fungsional/kepatuhan/teknis, dan §10 model
bisnis: apa statusnya di `origin/main` menurut standar bukti di `map.md`?

Wajib mengukur gerbang Fase 2 persis: *alur Payout dan Usage Report berjalan
tanpa intervensi basis data; Payment dari dua penyedia terekonsiliasi*. Silangkan
dengan `rilis-1-benda/scorecard.md`, dan tandai baris scorecard yang sudah basi.

Keluaran ke `.scratch/prd-audit/research/02-fase-2.md` di branch
`research/prd-audit-02`.

## Answer

Gerbang Fase 2 **tidak siap kode, tidak siap luncur**, gagal pada kedua
ukurannya: (1) alur Payout dan Usage Report tidak jalan tanpa `psql` — tidak
ada satu pun layar Payout (Fundraiser mengajukan, Admin menyetujui, Admin
menyelesaikan), dan Usage Report nol kode; (2) hanya ada satu penyedia
pembayaran nyata (`sumopod`), jadi "Payment dua penyedia terekonsiliasi"
secara harfiah mustahil. Refund dan Dormant Balance report (§7.3) juga nol
atau separuh kode. Pemblokir kode terpendek: layar Payout, model+layar Usage
Report, penyedia kedua (tiket 18), layar Refund, layar Suspension/Manual
Contribution Admin.

**Koreksi koordinator:** baris pengingat 30 hari sebelum Kind Authorisation
habis di riset ini semula ditandai ❌; itu keliru. `expiringWindows` di
`src/lib/collecting-entity.ts:136` sudah ada dengan default `days = 30` dan
tes (`src/lib/collecting-entity.test.ts`), jadi baris ini minimal 🟡
(kode+tes ada, belum ada layar Admin/Verifier yang terkonfirmasi
memanggilnya sebagai pengingat terjadwal — lihat catatan di
`research/02-fase-2.md` yang sudah diperbaiki dengan tanda "(dikoreksi
koordinator)").

Pointer: `.scratch/prd-audit/research/02-fase-2.md`.
