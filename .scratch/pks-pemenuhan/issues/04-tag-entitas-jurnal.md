# 04: Dua merchant account (yayasan + badan usaha) di satu gateway, jurnal ber-tag entitas, rekonsiliasi per entitas

**Blocked by:** 03 (slot skema)

**Status:** done

**What to build:** Kontrak Pasal 4.1(2) dan Pasal 10(4) (WAJIB). Owner memutuskan 2026-11-09 (kartu keputusan "Dua merchant di dalam FFI") bahwa pemisahan dibangun di dalam FFI, tidak cukup dengan ADR 0011. Tulis ADR baru yang memperluas ADR 0011: per platform tetap satu gateway (Sumopod), tetapi FFI memegang dua merchant account.

1. **Entitas merchant**: `YAYASAN` (donasi, zakat, wakaf/hibah: rekening pemegang izin) dan `BADAN_USAHA` (pendapatan platform/komersial, mis. biaya pendaftaran Volunteer Trip bila Admin menandainya komersial, dan pembayaran layanan berbayar lain di masa depan). Kredensial per merchant dari env (`SUMOPOD_<ENTITAS>_*`), dengan fallback kredensial lama ke YAYASAN agar produksi tidak berubah sampai owner mengisi env badan usaha. Tanpa kredensial BADAN_USAHA, transaksi komersial ditolak dengan pesan jelas (tidak pernah jatuh ke merchant yayasan).
2. **Routing**: layanan pembayaran menerima parameter merchant; satu fungsi murni memetakan tujuan transaksi -> entitas (donasi publik selalu YAYASAN, tidak bisa dioverride). Payment menyimpan entitas merchant.
3. **Webhook per merchant**: endpoint/secret per merchant (mis. `/api/webhooks/sumopod/[merchant]` atau verifikasi mencoba secret milik merchant yang tercatat di Payment), dan event dari merchant A tidak pernah bisa menyelesaikan Payment milik merchant B.
4. **Jurnal ber-tag entitas**: kolom entitas merchant (+ `collectingEntityId` Partner Organisation, + `actorId` untuk 4.3) pada `LedgerEntry`, diisi di setiap posting; backfill baris lama = YAYASAN (diuji terhadap DB berisi baris; trigger append-only harus tetap utuh setelah migrasi).
5. **Rekonsiliasi per entitas**: /admin/reconciliation dan /api/admin/reconcile menampilkan saldo dan selisih per entitas merchant; penarikan provider (ProviderWithdrawal) dicatat per entitas.

- [x] Test routing: donasi tidak pernah ke BADAN_USAHA; komersial tanpa kredensial badan usaha ditolak
- [x] Test webhook: signature merchant salah ditolak; event lintas merchant ditolak
- [x] Test setiap posting ledger membawa entitas; backfill + trigger diuji di DB nyata
- [x] Rekonsiliasi per entitas di layar dan API
- [x] docs/integrasi-sumopod.md + .env.example memuat env per merchant (tanpa nilai)
- [x] Review independen sonnet (uang)

## Comments

- ADR baru: `docs/adr/0027-two-merchant-accounts-inside-ffi.md` (memperluas 0011; 0011 diberi satu baris pointer).
- Routing: `merchantEntityForPurpose` (src/lib/payments/merchant.ts, murni). Donasi selalu YAYASAN; `chargeDonation` memanggilnya sendiri dan melempar `MerchantMismatchError` sebelum charge bila provider terikat merchant lain. Trip Fee YAYASAN kecuali `commercial: true`; penanda komersial di Trip BELUM ada, jadi sekarang semuanya YAYASAN (keputusan terbuka).
- Env: `SUMOPOD_<ENTITAS>_{API_KEY,WEBHOOK_SECRET,BASE_URL}`; YAYASAN jatuh kembali per variabel ke nama lama, BADAN_USAHA tanpa fallback. docker-compose(.prod) meneruskan keenam variabel baru. Production-readiness (sandbox di produksi/beta) dinilai per merchant.
- Webhook: handler dipindah ke `[provider]/handle-webhook.ts`; `/api/webhooks/[provider]` = YAYASAN (URL lama tetap), `/api/webhooks/[provider]/[merchant]` (`yayasan`, `badan-usaha`). Event terverifikasi merchant A atas Payment merchant B dijawab 200, tidak mengubah apa pun, `processedAt` tidak diisi. Dua allowlist properti (campaign-writers, collected-amount-single-writer) diperbarui ke path baru.
- Skema + migrasi `20261110090000_merchant_entity_ledger`: `LedgerEntry.merchantEntity` (wajib, tanpa default), `collectingEntityId`, `actorId`; `Payment` dan `ProviderWithdrawal` `merchantEntity` default YAYASAN. Backfill YAYASAN lewat `ADD COLUMN ... NOT NULL DEFAULT 'YAYASAN'` lalu `DROP DEFAULT` (metadata saja, tanpa UPDATE), jadi trigger append-only tidak pernah dimatikan. Diuji di DB berisi baris (`src/__tests__/merchant-entity-migration.test.ts`). `prisma migrate diff` kosong.
- `postTransaction` mewajibkan `merchantEntity` (tipe + cek runtime); tes properti `ledger-posting-merchant-entity` memindai semua call site dan memastikan tidak ada penulis ledger lain.
- Rekonsiliasi: `providerReconciliation.byEntity` di API dan bagian "Rekonsiliasi per merchant" di layar; angka seluruh-akun tetap dan sama dengan jumlahnya. Form penarikan punya pilihan merchant.
- Keputusan terbuka: (1) Payout dan gerakan off-gateway dibukukan YAYASAN; Trip Fee komersial yang kelak dicairkan lewat modul Payout akan salah kantong sampai penandanya ada. (2) `actorId` terisi di semua posting yang punya pelaku (refund, payout, manual contribution, transfer, penarikan); settlement webhook null. (3) Mock provider tidak punya merchant (kedua entitas memakai satu key, hanya dev).
- Review independen sonnet (uang): didispatch koordinator. Tidak ada BLOCKER; SHOULD-FIX ditindaklanjuti di commit "fix: tindak lanjut review independen tiket 04": migrasi diedit di tempat (FK NOT VALID + VALIDATE terpisah, indeks parsial untuk kolom yang hampir selalu null, catatan jalankan di periode sepi di header migrasi dan ADR); `WebhookEvent.merchantEntity` masuk kunci unik `(provider, merchantEntity, providerEventId)` (backfill YAYASAN), dan transactionId settlement BADAN_USAHA membawa entitasnya karena event id yang sama di dua merchant sebelumnya bentrok di klaim ledger (DuplicateLedgerTransactionError, ketemu oleh tes baru); tes secret sama di dua merchant dan 503 lewat env nyata; peringatan `sumopod_merchant_secrets_equal` saat boot; ADR: rekonsiliasi per entitas hanya baris non-sandbox; realign whitespace schema.prisma dibatalkan. Pendaftaran Trip sudah memakai `merchantEntityForPurpose`. Penanda komersial pada Trip: tiket 20.
