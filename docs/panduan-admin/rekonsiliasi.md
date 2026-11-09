# Rekonsiliasi

**Layar:** Admin > Rekonsiliasi (`/admin/reconciliation`). Data yang sama sebagai JSON di `GET /api/admin/reconcile`.
**Siapa:** Admin.

Layar ini **hanya melaporkan**; tidak ada yang dikoreksi otomatis. Satu-satunya yang ditulis adalah catatan penarikan dari penyedia. Prosedur rinci per kasus: [runbooks/payment-reconciliation.md](../runbooks/payment-reconciliation.md).

## Rutin (tiap pagi dan setelah tiap penarikan)

1. Buka halaman. **Ringkasan** menulis "Tidak ada temuan" bila ledger dan antrean bersih; bila ada, tabel pemeriksaan menandai angka di atas 0.
2. Baca **Saldo per penyedia**. Kolom Penarikan: **Cocok**, **Selisih Rp...** (cari penyebab di dashboard penyedia; selisih tidak dikoreksi), atau **Belum pernah dicek**.
3. Kerjakan **Antrean webhook yang perlu ditinjau** dan **Charge tanpa Payment** per kasus (runbook di atas). Cocokkan ID event penyedia atau referensi order dengan dashboard penyedia.

## Mencatat penarikan dari penyedia ke rekening

1. Catat saldo penyedia **tepat sebelum** dan **tepat sesudah** menarik.
2. Di **Catat penarikan dari penyedia**, isi penyedia, referensi penarikan, nominal, nama pemilik rekening tujuan, Collecting Entity (bila ada), kedua saldo, dan letak bukti.
3. **Catat penarikan**. Hasilnya muncul di **Penarikan tercatat** sebagai Cocok atau Selisih.

## Hal yang perlu diwaspadai

- Referensi penarikan yang sama tidak boleh dicatat dua kali; galat "sudah tercatat" berarti jangan diulang.
- Selama mode Beta (`BETA_SANDBOX`), pencatatan penarikan ditolak.
- Penandaan "selesai" untuk event antrean belum ada di layar; catat penyelesaiannya di catatan operasional (lihat runbook).
- Jalankan Rekonsiliasi dan pastikan seimbang **sebelum** membuka kembali donasi yang ditutup ([operasional.md](operasional.md)).
- Refund penuh uang yang tidak dibukukan dilakukan di dashboard penyedia, bukan di panel ini.
