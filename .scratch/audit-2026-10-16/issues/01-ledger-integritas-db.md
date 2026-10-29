# 01: Integritas buku besar di level database

**Latar:** Audit 2026-10-16, temuan data D1 dan D5 serta payments PAY-12. Buku besar (`LedgerEntry`) disebut append-only dan seimbang, tetapi hanya kode aplikasi yang menjaganya: FK-nya `ON DELETE SET NULL` (sebuah UPDATE yang diam-diam melepas leg dari Campaign/Payment bila induknya dihapus), tidak ada trigger, tidak ada CHECK, dan `paymentId`, `refundId`, `payoutId` yang disaring query dampak publik tidak berindeks. Tidak ada kode di `src/` yang meng-UPDATE atau DELETE `LedgerEntry` (satu-satunya pengecualian adalah helper fixture `stuck-refund-sweep.test.ts`), dan tidak ada kode yang menghapus induknya (ADR 0016).

**Blocked by:** none

**Status:** done

- [x] Indeks `LedgerEntry(paymentId)`, `(refundId)`, `(payoutId)` ada di `schema.prisma` dan migrasi `20261016090000_ledger_integrity`
- [x] Ketujuh FK `LedgerEntry` menjadi `onDelete: Restrict` (schema dan migrasi)
- [x] Trigger `LedgerEntry_append_only` menolak UPDATE dan DELETE; INSERT tetap jalan
- [x] CHECK `LedgerEntry_amount_positive` (`amount > 0`), selaras dengan `assertBalanced`
- [x] Tes DB nyata `src/__tests__/ledger-integrity-migration.test.ts` menerapkan migrasi pada database yang sudah berisi baris buku besar
- [x] `prisma validate` lolos, `migrate diff` kosong, tsc 19, eslint bersih pada berkas yang diubah

## Comments

2026-10-16 (builder): Trigger tanpa pengecualian, dengan FK diubah ke Restrict. Pilihan ini paling tidak invasif: tidak ada jalur sah yang meng-UPDATE/DELETE ledger atau menghapus induknya, sehingga carve-out "SET NULL saja" tidak diperlukan. TRUNCATE tidak memicu trigger baris. Satu tes (`stuck-refund-sweep`) menggeser `createdAt` lewat `updateMany`; fixture itu kini mematikan trigger di dalam satu transaksi. Tidak ditambahkan: CHECK pada Payment/Refund/Payout/ManualContribution dan Payment `donationId` XOR `registrationId` (belum diverifikasi terhadap semua penulis dan baris lama), serta constraint trigger debit = kredit per transactionId. Di produksi dengan ledger besar, buat tiga indeks dengan `CREATE INDEX CONCURRENTLY` lebih dulu (migrasi memakai `IF NOT EXISTS`).
