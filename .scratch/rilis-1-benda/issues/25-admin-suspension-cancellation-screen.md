# 25: Layar Admin -- Suspension dan Cancellation

**Type:** implementation

**Status:** open

**Blocked by:** —

## Why

Backend Suspension dan Cancellation sudah ada dan teruji; tidak ada layar
Admin yang memanggilnya. Satu dari empat item Q9. Owner 2026-09-28
(`prd-audit/triage-2026-09-28.md` Bagian A, Q9): `rilis-1-benda`, lajur L2,
satu tiket per layar -- pekerjaan mekanis berisiko rendah, cocok untuk
builder paralel begitu lajur L1 sibuk dengan Payout.

## Decision / scope

Layar Admin untuk memutuskan Suspension (dengan atau tanpa Flag) dan
menyetujui/menolak Cancellation.
