# 05: E4 organisation-team-members

**Status:** ready-for-agent

**Blocked by:** none; E4 dijawab owner 2026-10-04

**Ukuran:** L, skema, review uang

**Catatan:** Review uang: wajib review independen `sonnet` dengan bukti diposting di PR. Skema: satu PR skema pada satu waktu.

**Prasyarat:** Grilling peran anggota.

**Keputusan (2026-10-04, ronde C):** E4 anggota tim **tidak** boleh meminta Payout; permintaan Payout tetap milik akun Fundraiser utama organisasi.

## Latar

Anggota tim untuk Fundraiser organisasi: membership, peran, undangan, akses Payout. Rekomendasi C23 menolak anggota meminta Payout; bila ditolak, aturan dua orang dan pemisahan tugas harus dihitung ulang.

## Berkas relevan

- `CONTEXT.md` (Partner Organisation: anggota tim menyusul)
- ADR 0005 (peran sebagai Assignment terpisah)
- `prisma/schema.prisma`

## Acceptance

- [ ] Hasil grilling peran dicatat di tiket
- [ ] Model membership + undangan; migrasi tanpa kehilangan data
- [ ] Anggota tidak bisa meminta Payout (ditolak di domain, bukan hanya disembunyikan di UI); akses Payout tetap hanya akun Fundraiser utama; tes subject-guard dan aturan dua orang

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.

- 2026-10-04 (ronde C): E4 dijawab owner sesuai rekomendasi: anggota tim tidak boleh meminta Payout. Dengan begitu aturan dua orang dan pemisahan tugas tidak perlu dihitung ulang. Yang tidak ditanyakan: rincian peran anggota selain Payout; builder memakai peran minimal tanpa akses uang dan mencatatnya di PR untuk persetujuan owner. Kode uang tetap memerlukan review independen `sonnet`. `needs-info` menjadi `ready-for-agent`.
