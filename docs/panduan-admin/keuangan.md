# Keuangan dan rekap

**Layar:** Admin > Rekap Keuangan (`/admin/finance`), Laporan Dormant Balance (`/admin/dormant-balances`), Manual Contribution (`/admin/manual-contributions`, catat di `/new`, putuskan di `/[id]`), Transfer antar Campaign (`/admin/campaign-transfers`).
**Siapa:** Admin.

## Rekap keuangan

1. Buka **Rekap Keuangan**. Angkanya adalah jumlah entri ledger per **periode x Kind x Campaign**; periode adalah bulan kalender WIB.
2. Unduh CSV (kolom sama dengan layar) dari tombol ekspor; rutenya `GET /api/admin/finance/recap`.
3. Hanya uang nyata: transaksi sandbox (Beta) tidak pernah masuk angka.

## Dormant Balance (hanya baca)

Daftar Campaign Expired atau Completed yang masih memegang saldo 60 hari atau lebih. Tidak ada tombol aksi: tindak lanjutnya manual, yaitu Payout biasa ([penyaluran.md](penyaluran.md)). Realokasi saldo setelah 180 hari belum ada di Rilis 1.

## Manual Contribution (uang masuk di luar gateway)

1. **Admin A** mencatat di `/new`: Campaign atau Program tujuan, nominal, dan bukti.
2. **Admin B** (bukan A) membuka baris PENDING dan **menyetujui** atau **menolak**. Hanya persetujuan yang membukukan saldo, langsung tanpa Escrow Hold dan tanpa fee.
3. Salah catat dikoreksi dengan **pembalikan** oleh **Admin C** (bukan pencatat, bukan pemutus), dengan alasan. Entri tidak pernah dihapus; pembalikan membuat jurnal lawan.

## Transfer antar Campaign

Untuk Campaign wakaf atau hibah yang **Suspended**: saldonya dialihkan ke Campaign Active lain ber-Kind sama, alih-alih dikembalikan ke Donor ([ADR 0015](../adr/0015-suspension-reaches-closed-campaigns.md)).

1. **Admin A** mengajukan lewat `POST /api/admin/campaign-transfers`.
2. **Admin B** memutuskan di layar ini. Wakaf hanya ke wakaf ber-Category sama; hibah hanya ke hibah; lintas Kind ditolak.
3. Yang berpindah selalu **seluruh saldo yang bisa dicairkan**; Escrow Hold yang belum matang tetap di Campaign asal. Donor Campaign asal diberi tahu.

## Hal yang perlu diwaspadai

- Admin pemilik salah satu Campaign yang terlibat ditolak memutuskan transfer.
- Tujuan transfer harus Active dan bukan Demo Campaign.
- Rekap membaca ledger, bukan penghitung tampilan; bila beda dengan dashboard penyedia, kerjakan lewat [rekonsiliasi.md](rekonsiliasi.md).
