# 48: Batch dengan registrasi berbayar tidak boleh diubah tanggal dan kuota

**Type:** implementation (keamanan, kode uang)

**Status:** needs-triage

**Blocked by:** none

## Why

Audit keamanan menemukan celah yang memungkinkan fundraiser mengubah tanggal dan kuota Batch setelah ada registrasi berbayar, mengakibatkan refund Volunteer dikuras atau pembatalan terhenti.

Detail teknis disimpan owner di luar repo publik.

## Scope

- Batch dengan registrasi aktif menolak perubahan tanggal ke masa lalu atau perubahan kuota di bawah jumlah seat terpakai
- Tanggal baru harus di masa depan
- Payout Trip Fee ditunda sampai Batch selesai atau keberangkatan tiba

## Acceptance

- Tes: Batch dengan registrasi menolak perubahan tanggal atau kuota yang merugikan
- Tes: Batch kosong tetap bisa diedit
- Menyentuh kode uang: review independen `sonnet` wajib
