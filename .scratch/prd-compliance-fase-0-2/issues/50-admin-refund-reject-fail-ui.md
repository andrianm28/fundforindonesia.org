# 50: UI Admin untuk menolak dan menandai gagal Refund

**Status:** needs-triage

**Blocked by:** 49 (done)

Tiket 49 (PR #203) menambah `rejectRefund` dan `failRefund` beserta route Admin
untuk Campaign dan Volunteer Trip, tetapi belum ada tombol di halaman Admin.
Sampai tiket ini dikerjakan, kedua aksi hanya bisa dijalankan lewat API.

- [ ] Tombol Tolak pada Refund REQUESTED/AWAITING_DONOR_DETAILS dan tombol
      Tandai gagal pada Refund APPROVED, masing-masing dengan isian alasan
- [ ] Tombol disembunyikan bagi Admin yang dilarang aturan aktor (pembuat,
      pemberi approve, Fundraiser), dan pesan 403/409 dari route ditampilkan
- [ ] Tes komponen untuk kedua aksi

## Comments
