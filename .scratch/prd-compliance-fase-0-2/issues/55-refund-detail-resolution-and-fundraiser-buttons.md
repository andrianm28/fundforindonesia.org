# 55: Detail Refund menampilkan penyelesaiannya; tombol approve/complete disembunyikan bagi Fundraiser

**Status:** needs-triage

**Blocked by:** none (50 done)

Lanjutan yang sengaja tidak dicakup tiket 50 (PR #206).

- Halaman `/admin/refunds/[id]` belum menampilkan siapa yang menolak atau
  menandai gagal, kapan, dan alasannya. `rejectionReason` dan `failureReason`
  tersimpan tetapi tidak terbaca di UI.
- Form approve dan complete belum menyembunyikan tombol bagi Fundraiser subjek;
  penolakannya tetap datang dari server (403), hanya Tolak dan Tandai gagal yang
  sudah menggantinya dengan kalimat penjelas.

- [ ] Refund REJECTED/FAILED menampilkan aktor, waktu, dan alasan
- [ ] Approve/complete diganti kalimat penjelas bagi Fundraiser subjek, pola
      yang sama dengan `AdminRefundResolveForm`
- [ ] Tes komponen dan halaman

## Comments

- 2026-10-03 (merge): PR #216 merge sebagai `9d91c98`, CI hijau, review independen diposting di PR.
