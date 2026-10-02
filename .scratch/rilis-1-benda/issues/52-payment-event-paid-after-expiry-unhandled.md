# 52: Event pembayaran setelah expired diabaikan; charge berhasil tapi DB gagal tidak tercatat

**Type:** implementation (keamanan, kode uang)

**Status:** needs-triage

**Blocked by:** none

## Why

Audit keamanan menemukan dua celah pada pencatatan pembayaran: (1) webhook event pembayaran untuk Payment yang sudah expired diabaikan tanpa rekonsiliasi, dan (2) charge berhasil di provider tapi gagal dicatat di database, meninggalkan dana orphaned tanpa jalur refund.

Detail teknis disimpan owner di luar repo publik.

## Scope

- Webhook mencatat event pembayaran untuk Payment expired/failed untuk reconciliation manual
- Charge di provider harus atomic dengan pencatatan di database; jika gagal, charge di-cancel
- Dokumentasi jalur reconciliation untuk dana yang hang

## Acceptance

- Tes: Event pembayaran expired dicatat untuk reconciliation
- Tes: Charge gagal di-cancel otomatis atau dicatat untuk manual intervention
- Menyentuh kode uang: review independen `sonnet` wajib
