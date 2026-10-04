# 07: E6 whatsapp-notifications

**Status:** needs-info

**Blocked by:** none (tiket); menunggu onboarding Meta/BSP (A3) dan persetujuan sesuai UU PDP (A4)

**Ukuran:** L

**Catatan:** Menyimpan nomor telepon dan consent: review privasi.

**Prasyarat:** Verifikasi Meta/WhatsApp Business (A3) dan consent PDP (A4).

**Menunggu keputusan:** C23 (E6). Penyedia (BSP) mana dan berapa biayanya, dan model consent apa yang dipakai? (rekomendasi tidak ada di rencana)

## Latar

Notifikasi WhatsApp: notifier di samping mail, dengan consent. Email transaksional tetap cukup untuk gerbang Fase 0 sampai 2.

## Berkas relevan

- `plan.md` A3, A4, G5
- PRD §6 daftar pengecualian (amandemen 2026-10-04)
- `src/lib/mail/`

## Acceptance

- [ ] BSP, biaya, dan model consent diputuskan owner
- [ ] Notifier WhatsApp di samping mail; template disetujui; gagal kirim tidak menggagalkan transaksi
- [ ] Tes dan e2e; consent dicatat dan bisa dicabut

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.
