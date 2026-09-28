# 27: Layar Admin -- konfigurasi ambang penyalahgunaan (abuse-thresholds)

**Type:** implementation

**Status:** in-review

**Blocked by:** —

## Why

Backend konfigurasi ambang (mis. ambang kemiripan judul Petunjuk Duplikat,
ambang Penanda Audit/Donasi) sudah ada dan teruji; tidak ada layar Admin yang
memanggilnya. Satu dari empat item Q9. Owner 2026-09-28
(`prd-audit/triage-2026-09-28.md` Bagian A, Q9): `rilis-1-benda`, lajur L2,
satu tiket per layar.

## Decision / scope

Layar Admin untuk membaca dan mengubah ambang-ambang yang sudah bisa diatur
di kode (`route.ts` `abuse-thresholds`), tanpa menambah ambang baru.
