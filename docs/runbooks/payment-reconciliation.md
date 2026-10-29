# Runbook: rekonsiliasi pembayaran

Dipakai Admin untuk mencocokkan ledger dengan saldo di payment provider, dan untuk uang yang ada di provider tetapi tidak ada pencatatan atau refund yang cocok di aplikasi. Asal: tiket 52 (`.scratch/rilis-1-benda/issues/52-payment-event-paid-after-expiry-unhandled.md`), keputusan di [ADR 0021](../adr/0021-donation-paid-after-expiry-still-settles.md) dan [ADR 0011](../adr/0011-separate-merchant-account-from-makam.md). Layarnya **Admin Panel > Rekonsiliasi** (`/admin/reconciliation`, tiket 63); tidak perlu psql. Halaman ini hanya melaporkan, tidak ada yang dikoreksi otomatis.

## Rutin (mis. tiap pagi dan setelah tiap penarikan)

1. Buka **Rekonsiliasi**. Bagian **Ringkasan** menulis "Tidak ada temuan" bila ledger dan antrean bersih. Bila ada temuan, tabel pemeriksaan menandai yang lebih dari 0 dan barisnya tampil di bawahnya.
2. Bagian **Saldo per penyedia**: saldo tiap penyedia menurut ledger. Kolom Penarikan:
   - **Cocok**: penurunan saldo di dashboard penyedia sama dengan nominal yang dicatat.
   - **Selisih Rp...**: penyedia memindahkan uang yang tidak dicatat platform (biaya transfer, chargeback, pencairan di luar platform). Cari penyebabnya di dashboard penyedia; selisih itu tidak dikoreksi.
   - **Belum pernah dicek**: belum ada penarikan tercatat untuk penyedia ini, jadi belum diperiksa (bukan lolos).
   Bila muncul catatan "bergerak tanpa nama penyedia", saldo per penyedia adalah batas bawah.
3. Bagian **Antrean webhook yang perlu ditinjau** dan **Charge tanpa Payment**: kerjakan per kasus di bawah.

## Mencatat penarikan dari penyedia ke rekening

Setiap kali saldo penyedia ditarik ke rekening bank yayasan:

1. Di dashboard penyedia, catat saldo **tepat sebelum** penarikan, lakukan penarikan, lalu catat saldo **tepat sesudah**.
2. Di **Rekonsiliasi > Catat penarikan dari penyedia**, isi penyedia, referensi penarikan dari dashboard, nominal, nama pemilik rekening tujuan, Collecting Entity (bila rekening itu milik Collecting Entity terdaftar), kedua saldo, dan letak buktinya. Titik ribuan boleh diketik.
3. Klik **Catat penarikan**. Penarikan muncul di tabel **Penarikan tercatat** dengan hasil Cocok atau Selisih.
4. Galat ditampilkan di bawah tombol. Yang umum: referensi sudah tercatat (uang yang sama tidak boleh diklaim dua kali; jangan dicatat ulang), penyedia tidak dikenal, nominal bukan angka bulat di atas nol, bukti kosong. Selama mode Beta (`BETA_SANDBOX` aktif) pencatatan ditolak.

## Per kasus di antrean

Kolom **Jenis** menampilkan nama dan kode outcome. Daftar outcome yang butuh Admin ada di `WEBHOOK_OUTCOMES_NEEDING_REVIEW` (`src/lib/money/payment-reconciliation.ts`). Cocokkan **ID event penyedia** atau **Referensi order** dengan dashboard penyedia.

1. `UNKNOWN_PAYMENT` (Payment tidak dikenal) yang referensinya cocok dengan baris di **Charge tanpa Payment**: charge yatim itu sudah dibayar. Refund penuh di dashboard provider.
2. Baris **Charge tanpa Payment** tanpa event `paid`: batalkan charge di provider (interface `PaymentProvider` belum punya `cancelCharge`).
3. `SIBLING_ALREADY_PAID`: Payment Donation lain pada Donation yang sama sudah settle, jadi event ini tidak dibukukan. Tidak ada refund otomatis. Admin me-refund penuh uang Payment ini di dashboard provider, lalu mencatatnya.
4. `AMOUNT_MISMATCH` (Nominal tidak cocok): tidak ada yang dibukukan. Cocokkan nominal dengan provider, lalu putuskan refund atau koreksi manual.
5. `LATE_SETTLEMENT_REFUND_FAILED`: Trip Fee sudah masuk ledger, tetapi refund otomatis untuk Registration yang kursinya hilang (EXPIRED atau CANCELLED) gagal. Sweep `sweepStuckLateSettlementRefunds` (tiket 43) mengulanginya otomatis. Bila baris event masih ada setelah satu putaran sweep, buat Refund penuh manual (`createRefund`) dan catat di dashboard provider.
6. Penandaan selesai belum ada di layar: event webhook tidak punya kolom penyelesaian, dan `resolvedAt`/`resolutionNote` pada Charge tanpa Payment masih diisi lewat SQL oleh owner. Sampai ada, catat penyelesaiannya di catatan operasional.

Data yang sama tersedia sebagai JSON di `GET /api/admin/reconcile` (laporan) untuk otomasi; layar dan API memakai fungsi yang sama (`src/lib/money/reconciliation-report.ts`).
