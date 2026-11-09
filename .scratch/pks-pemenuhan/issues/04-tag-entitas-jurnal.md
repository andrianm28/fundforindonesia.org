# 04: Tag entitas di jurnal + rekonsiliasi per entitas

**Blocked by:** 03 (slot skema)

**Status:** ready-for-agent

**What to build:** Kontrak Pasal 4.1(2) mewajibkan jurnal ber-tag entitas dan rekonsiliasi per entitas. ADR 0011 memisahkan merchant per platform (FFI = merchant yayasan), tetapi `LedgerEntry` tidak punya kolom entitas, dan ADR 0010 sudah menyatakan ledger semestinya membawa entitas penghimpun. Tambahkan kolom entitas penerima (`collectingEntityId` ke Partner Organisation, nullable untuk baris platform seperti PLATFORM_FEE) pada `LedgerEntry`, isi di setiap posting baru dari subjek (Campaign/Volunteer Trip), backfill baris lama dari Payment -> Donation -> Campaign, dan tambah kolom pelaku (`actorId`, nullable untuk webhook) agar 4.3 'administrator yang melakukan perubahan' tercatat di entri. Laporan rekonsiliasi (/admin/reconciliation dan /api/admin/reconcile) menampilkan saldo per entitas. Trigger append-only tetap; backfill dilakukan di migrasi sebelum trigger berlaku untuk UPDATE, atau dengan menonaktifkan trigger di dalam migrasi secara eksplisit dan diuji.

- [ ] Migrasi + backfill diuji terhadap DB nyata berisi baris
- [ ] Setiap fungsi posting di src/lib/money/ledger.ts mengisi entitas; test memastikan tidak ada posting subjek tanpa entitas
- [ ] Rekonsiliasi per entitas di layar dan API
- [ ] Review independen sonnet (uang)
