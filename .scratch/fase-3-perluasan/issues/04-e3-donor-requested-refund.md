# 04: E3 donor-requested-refund

**Status:** needs-info

**Blocked by:** none; keputusan: perubahan PRD 7.2 dan ADR 0018, aturan kelayakan dan anti-abuse (C23)

**Ukuran:** M-L, review uang

**Catatan:** Review uang: wajib review independen `sonnet` dengan bukti diposting di PR. Angka anti-abuse tidak ditulis di repo publik.

**Prasyarat:** Mengubah PRD §7.2 dan ADR 0018; aturan kelayakan dan anti-abuse.

**Menunggu keputusan:** C23 (E3). Jendela waktu, batas per Kind, dan pengamanan anti-abuse untuk Refund yang dimulai Donor. (rekomendasi angka tidak ada di rencana; prinsip: kode uang, wajib review independen)

## Latar

Donor dapat meminta Refund sendiri. Saat ini Refund hanya dimulai Admin.

## Berkas relevan

- `docs/PRD-fund-for-indonesia.md:158` (§7.2)
- `src/lib/money/refunds.ts`
- `CONTEXT.md` (Refund)
- ADR 0018

## Acceptance

- [ ] PRD §7.2 dan ADR 0018 diamandemen oleh koordinator
- [ ] Aturan kelayakan, jendela waktu, batas per Kind diputuskan owner
- [ ] Alur permintaan Donor sampai persetujuan Admin; tes uang dan anti-abuse

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.
