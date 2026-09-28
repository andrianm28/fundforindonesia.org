# 21: Payout screens -- Fundraiser request, Admin approve, Admin complete with proof

**Type:** implementation

**Status:** open

**Blocked by:** 17 (resolved)

## Why

Gerbang Fase 2 nomor satu: backend Payout lengkap dan teruji
(`src/lib/money/payouts.ts`), tapi tak satu `.tsx` non-test pun memanggil
rutenya. Owner 2026-09-28 (`prd-audit/triage-2026-09-28.md` Bagian A, Q4):
`rilis-1-benda`, lajur L1, prioritas tertinggi -- tanpa ini Soft Launch
mustahil (Donation tidak bisa sampai ke rekening Fundraiser).

## Decision / scope

Tiga layar: pengajuan Fundraiser, persetujuan Admin (dua-orang), penyelesaian
Admin dengan bukti transfer. PR #114 (branch `pr94-rebase`) sudah memuat
account picker untuk Campaign; ticket 17 sudah menjawab kalimat empty-state-
nya (tautan ke `/akun/rekening`, kalimat pembeda "belum pernah menambahkan"
vs "ada yang ditolak"). Tiket ini menuntaskan sisanya: layar Admin approve +
complete, dan Payout Volunteer Trip (rute sudah ada, panel Campaign tidak
reusable langsung -- lihat ticket 17 poin 3, clone panel setelah #114 merge).
