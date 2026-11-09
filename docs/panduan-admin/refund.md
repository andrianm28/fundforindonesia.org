# Refund

**Layar:** Admin > Refund (`/admin/refunds`, buat di `/admin/refunds/new`, detail `/admin/refunds/[id]`).
**Siapa:** Admin. Donor juga bisa meminta Refund atas Donation miliknya (fitur mati bila batasnya tidak dikonfigurasi, lihat `DONOR_REFUND_*` di `.env.example`).

Refund mengembalikan satu Payment ke Donor sebesar **Gross penuh** atau sebagian; Provider Fee yang tidak kembali ditanggung platform ([ADR 0007](../adr/0007-refunds-return-gross-platform-absorbs-provider-fee.md)). Antrean memuat **REQUESTED** dan **APPROVED**.

## Tiga langkah, tiga Admin berbeda

1. **Membuat** (Admin A): `/admin/refunds/new` untuk Payment Campaign atau Volunteer Trip, dengan alasan. Permintaan Donor langsung berstatus REQUESTED dengan Donor sebagai pengaju. Dananya dibekukan (Frozen Balance); belum ada uang keluar.
2. **Menyetujui** (Admin B, bukan A): baca permintaan tertulis Donor, lalu ketik **kode bank, nama pemilik rekening, dan nomor rekening** tujuan. Server menolak persetujuan bila salah satu kosong.
3. **Menyelesaikan** (Admin C, bukan A dan bukan B): transfer manual ke rekening yang dicatat Admin B, lalu isi **bukti transfer** (referensi dan catatan) dan **ketik ulang nomor rekening** dari permintaan tertulis Donor sebagai pasangan mata kedua. Nomor harus cocok dengan yang dicatat saat persetujuan.

## Jalan keluar tanpa uang sampai ke Donor

- **Tolak** (belum disetujui) dengan alasan tercatat: dana beku kembali ke saldo asal.
- **Gagal** (sudah disetujui, tetapi Donor tidak bisa dibayar): tandai FAILED dengan alasan; dana kembali.

## Hal yang perlu diwaspadai

- Aturan tiga orang di atas ditegakkan server; layar hanya menjelaskan lebih awal mengapa tombol tidak muncul.
- Donor Tamu tidak punya profil, jadi rekening tujuan dicatat langsung pada Refund (bukan lewat Verifier).
- Refund hanya sebelum ada Payout Campaign itu yang diajukan atau berjalan, dalam jendela waktu dan batas nominal per Kind.
- Payment yang masuk setelah kedaluwarsa atau ganda ditangani lewat Rekonsiliasi ([rekonsiliasi.md](rekonsiliasi.md)).
- Refund oleh Donor mendapat email hasil bila email terkonfigurasi; kegagalan email hanya dicatat log ([runbooks/insiden.md](../runbooks/insiden.md)).
