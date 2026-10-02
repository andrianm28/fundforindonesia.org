# 21: Payout screens -- Fundraiser request, Admin approve, Admin complete with proof

**Type:** implementation

**Status:** done (PR #126, 8ffabdd)

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

## Implementation note (branch `claude/ticket-21-admin-payout-screens`)

Dibangun: `/admin/payouts` (antrean DRAFT "menunggu persetujuan" dan APPROVED
"menunggu penyelesaian"), `/admin/payouts/[id]` (form approve/complete),
`AdminPayoutActionForm` (menangani subjek Campaign maupun Volunteer Trip),
tautan nav Admin. Ticket 02's provider-balance gate sudah ada di
`src/lib/money/payouts.ts` sebelum ticket ini (session lain); form approve
memakainya langsung. Ticket 12's jawaban diikuti dengan tidak pernah membaca
nomor rekening di layar mana pun.

Ticket 13's jawaban (referensi transaksi + kalimat bebas, wajib) ditegakkan
di **server**: `completePayout` menerima `proofReference` dan `proofNote` dan
memvalidasinya lewat `src/lib/payout-proof.ts`, modul yang sama dengan yang
dipakai form. Route complete hanya memeriksa tipe; aturannya milik
`completePayout` (`PayoutProofInvalidError`, 400). Layar
Volunteer Trip yang dibangun di sini hanya sisi Admin (approve/complete);
panel Fundraiser untuk MENGAJUKAN Payout Trip (clone CampaignPayoutPanel)
tidak termasuk brief ini dan masih belum ada.

**Belum:** opsi Admin mencatat "sudah dicek, kurang" sebagai keputusan
tertunda (jawaban tiket 02, bagian kedua). Hari ini approve hanya ditolak
dengan `ProviderBalanceInsufficientError`, tanpa jejak keputusan. Dipisah ke
[30](30-provider-balance-pending-decision.md), karena butuh tempat menyimpan
keputusan itu.

## Comments

- 2026-10-02: done. Merged di PR #126 (8ffabdd). Status sebelumnya `in-review` (label tidak sah); dikoreksi koordinator.
