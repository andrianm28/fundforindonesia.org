# 05: E4 organisation-team-members

**Status:** needs-info

**Blocked by:** none; menunggu grilling peran (C23)

**Ukuran:** L, skema, review uang

**Catatan:** Review uang: wajib review independen `sonnet` dengan bukti diposting di PR. Skema: satu PR skema pada satu waktu.

**Prasyarat:** Grilling peran anggota.

**Menunggu keputusan:** C23 (E4). Peran apa yang dimiliki anggota, dan bolehkah anggota meminta Payout? (rekomendasi: tidak; permintaan Payout tetap milik akun Fundraiser utama organisasi)

## Latar

Anggota tim untuk Fundraiser organisasi: membership, peran, undangan, akses Payout. Rekomendasi C23 menolak anggota meminta Payout; bila ditolak, aturan dua orang dan pemisahan tugas harus dihitung ulang.

## Berkas relevan

- `CONTEXT.md` (Partner Organisation: anggota tim menyusul)
- ADR 0005 (peran sebagai Assignment terpisah)
- `prisma/schema.prisma`

## Acceptance

- [ ] Hasil grilling peran dicatat di tiket
- [ ] Model membership + undangan; migrasi tanpa kehilangan data
- [ ] Akses Payout sesuai keputusan, dengan tes subject-guard dan aturan dua orang

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.
