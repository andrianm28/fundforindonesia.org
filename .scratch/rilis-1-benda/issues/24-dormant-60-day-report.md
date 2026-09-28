# 24: Laporan Dormant Balance 60 hari

**Type:** implementation

**Status:** open

**Blocked by:** —

## Why

Gerbang Fase 2 §7.3, PRD sendiri menyebutnya murah dan masuk rilis pertama.
Terpisah dari pengalihan Dormant Balance (yang di luar Rilis 1 -- lihat
`prd-audit/map.md` Out of scope). Owner 2026-09-28
(`prd-audit/triage-2026-09-28.md` Bagian A, Q8): `rilis-1-benda`, lajur
L1/L2 -- ukurannya kecil, tidak ada alasan menunda sesuatu yang PRD sendiri
sudah tandai murah.

## Decision / scope

Laporan saja: Campaign Balance pada Campaign Expired/Completed yang tidak
dicairkan >= 60 hari, dibaca Admin. **Bukan** pengalihannya ke Campaign lain
-- itu tetap di luar Rilis 1.
