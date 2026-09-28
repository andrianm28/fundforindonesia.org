# 23: Refund -- siklus minimal (create -> approve) dan layarnya

**Type:** implementation

**Status:** open

**Blocked by:** —

## Why

Hanya REQUESTED dan APPROVED yang punya kode; siklus penuh
(AwaitingDonorDetails, Processing, Completed, Rejected, Failed) dan layarnya
nol. Owner 2026-09-28 (`prd-audit/triage-2026-09-28.md` Bagian A, Q7):
`rilis-1-benda`, lajur L1, dengan **cakupan dipersempit dulu**: hanya
REQUESTED→APPROVED manual untuk Rilis 1, status lain menyusul di rilis
berikutnya, dicatat sebagai keputusan sengaja -- siklus penuh + tautan
bertanda tangan 30 hari + bukti transfer Donor berisiko menunda gerbang
Fase 2 tanpa perlu.

## Decision / scope

Layar create (Admin) + approve (Admin lain) saja untuk Rilis 1. State
machine `RefundStatus` yang lebih luas tetap ada di skema untuk rilis
berikutnya, tidak dibongkar.
