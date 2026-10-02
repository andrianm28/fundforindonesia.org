# 49: Payout Trip Fee ditarik sebelum Batch selesai atau keberangkatan tiba

**Type:** implementation (keamanan, kode uang)

**Status:** needs-info

**Blocked by:** none

## Why

Audit keamanan menemukan celah pada payout Trip Fee: uang terkumpul bisa ditarik sebelum Batch selesai, sehingga Volunteer yang membatalkan kemudian dibayar refund dari pool platform bukan dari collected fees.

Detail teknis disimpan owner di luar repo publik.

## Scope

- Payout Trip Fee menunggu Batch COMPLETED atau keberangkatan telah lewat
- Payout tidak menguras pool selagi ada registrasi aktif yang bisa direfund

## Acceptance

- Tes: Payout menolak sebelum Batch selesai atau tanggal lewat
- Tes: Payout berhasil setelah kondisi terpenuhi
- Menyentuh kode uang: review independen `sonnet` wajib
