# 04: Dua merchant account (yayasan + badan usaha) di satu gateway, jurnal ber-tag entitas, rekonsiliasi per entitas

**Blocked by:** 03 (slot skema)

**Status:** ready-for-agent

**What to build:** Kontrak Pasal 4.1(2) dan Pasal 10(4) (WAJIB). Owner memutuskan 2026-11-09 (kartu keputusan "Dua merchant di dalam FFI") bahwa pemisahan dibangun di dalam FFI, tidak cukup dengan ADR 0011. Tulis ADR baru yang memperluas ADR 0011: per platform tetap satu gateway (Sumopod), tetapi FFI memegang dua merchant account.

1. **Entitas merchant**: `YAYASAN` (donasi, zakat, wakaf/hibah: rekening pemegang izin) dan `BADAN_USAHA` (pendapatan platform/komersial, mis. biaya pendaftaran Volunteer Trip bila Admin menandainya komersial, dan pembayaran layanan berbayar lain di masa depan). Kredensial per merchant dari env (`SUMOPOD_<ENTITAS>_*`), dengan fallback kredensial lama ke YAYASAN agar produksi tidak berubah sampai owner mengisi env badan usaha. Tanpa kredensial BADAN_USAHA, transaksi komersial ditolak dengan pesan jelas (tidak pernah jatuh ke merchant yayasan).
2. **Routing**: layanan pembayaran menerima parameter merchant; satu fungsi murni memetakan tujuan transaksi -> entitas (donasi publik selalu YAYASAN, tidak bisa dioverride). Payment menyimpan entitas merchant.
3. **Webhook per merchant**: endpoint/secret per merchant (mis. `/api/webhooks/sumopod/[merchant]` atau verifikasi mencoba secret milik merchant yang tercatat di Payment), dan event dari merchant A tidak pernah bisa menyelesaikan Payment milik merchant B.
4. **Jurnal ber-tag entitas**: kolom entitas merchant (+ `collectingEntityId` Partner Organisation, + `actorId` untuk 4.3) pada `LedgerEntry`, diisi di setiap posting; backfill baris lama = YAYASAN (diuji terhadap DB berisi baris; trigger append-only harus tetap utuh setelah migrasi).
5. **Rekonsiliasi per entitas**: /admin/reconciliation dan /api/admin/reconcile menampilkan saldo dan selisih per entitas merchant; penarikan provider (ProviderWithdrawal) dicatat per entitas.

- [ ] Test routing: donasi tidak pernah ke BADAN_USAHA; komersial tanpa kredensial badan usaha ditolak
- [ ] Test webhook: signature merchant salah ditolak; event lintas merchant ditolak
- [ ] Test setiap posting ledger membawa entitas; backfill + trigger diuji di DB nyata
- [ ] Rekonsiliasi per entitas di layar dan API
- [ ] docs/integrasi-sumopod.md + .env.example memuat env per merchant (tanpa nilai)
- [ ] Review independen sonnet (uang)
