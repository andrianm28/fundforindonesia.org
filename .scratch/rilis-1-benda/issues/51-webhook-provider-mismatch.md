# 51: Webhook tidak validasi kecocokan provider; mock provider aktif di produksi

**Type:** implementation (keamanan)

**Status:** needs-triage

**Blocked by:** none

## Why

Audit keamanan menemukan dua celah pada webhook: (1) webhook tidak validasi bahwa provider di URL cocok dengan provider di database, dan (2) mock provider tetap aktif di produksi jika env var tidak dihapus.

Detail teknis disimpan owner di luar repo publik.

## Scope

- Webhook validasi kecocokan provider di URL dengan provider di database
- Mock provider hanya aktif saat test, tidak di produksi

## Acceptance

- Tes: Webhook dengan provider tidak cocok ditolak
- Tes: Webhook mock ditolak di non-test
- Dokumentasi: .env produksi tanpa MOCK_MIDTRANS_SERVER_KEY
