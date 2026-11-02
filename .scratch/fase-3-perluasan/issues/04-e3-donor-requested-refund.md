# 04: E3 donor-requested-refund

**Status:** done

**Blocked by:** none; E3 dijawab owner 2026-10-04. Koordinator mengamandemen PRD §7.2 dan ADR 0018 lebih dulu (lihat Acceptance).

**Ukuran:** M-L, review uang

**Catatan:** Review uang: wajib review independen `sonnet` dengan bukti diposting di PR. Angka anti-abuse tidak ditulis di repo publik.

**Prasyarat:** Mengubah PRD §7.2 dan ADR 0018; aturan kelayakan dan anti-abuse.

**Keputusan (2026-10-04, ronde C):** E3 Refund oleh Donor hanya sebelum Payout dan dalam jendela waktu, ada batas per Kind, dan Admin menyetujui. Angka anti-abuse tersamar dan tidak ditulis di repo publik.

## Latar

Donor dapat meminta Refund sendiri. Saat ini Refund hanya dimulai Admin.

## Berkas relevan

- `docs/PRD-fund-for-indonesia.md:158` (§7.2)
- `src/lib/money/refunds.ts`
- `CONTEXT.md` (Refund)
- ADR 0018

## Acceptance

- [x] PRD §7.2 dan ADR 0018 diamandemen oleh koordinator (PR #305: PRD §7.2 dan amandemen ADR 0007, tempat aturan Refund kini berada)
- [x] Aturan diputuskan owner 2026-10-04: hanya sebelum Payout, jendela waktu, batas per Kind, Admin menyetujui. Angkanya tidak ditulis di repo publik; owner menyampaikannya ke koordinator, yang meneruskannya lewat brief dispatch
- [x] Alur permintaan Donor sampai persetujuan Admin; tes uang dan anti-abuse (PR #305, review independen diposting di PR)

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.

- 2026-10-04 (ronde C): E3 dijawab owner: Donor boleh memulai Refund hanya **sebelum Payout** dan dalam **jendela waktu**, dengan **batas per Kind**, dan **Admin menyetujui**. Angka anti-abuse (jendela, batas, pengamanan) tersamar: tidak dicantumkan di repo publik. Kode uang: review independen `sonnet` wajib. PRD §7.2 dan ADR 0018 tetap diamandemen koordinator sebelum builder mulai. `needs-info` menjadi `ready-for-agent`.

- 2026-11-02: `done`. PR #305 merge ke `main` (7017824). Fitur mati sampai owner mengisi env `DONOR_REFUND_*` di server setelah deploy.
