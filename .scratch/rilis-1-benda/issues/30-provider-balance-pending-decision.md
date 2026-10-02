# 30: Admin records "checked, short" as a pending decision when the provider balance is too low

**Type:** implementation

**Status:** done (PR #131)

**Blocked by:** 21

## Why

Ticket 02's answer (owner, 2026-09-28) has two halves: refuse approval when the
recorded provider balance is below the requested amount, **and** give the Admin
an explicit option to record "sudah dicek, kurang" as a pending decision. FFI-07
calls that record the substitute for the balance API the provider does not
have. Only the first half exists: `approvePayout` throws
`ProviderBalanceInsufficientError` and nothing is kept. The independent Spec
review of ticket 21's PR found the gap; it predates ticket 21.

## Question

Where the pending decision lives (a Payout status, a separate record, or an
audit entry), who may clear it, and what the Fundraiser sees while it is
pending. Then build it on the Admin approve form and in `approvePayout`, with
the refusal and the record in one transaction.

## Answer

Owner (Dri), 2026-09-28, "ya semua" to the recommendation below:

- **Q1 (where it lives):** a separate action on the approve form, "Catat:
  saldo penyedia kurang", that records the provider balance read, who
  checked, and when, as a **check history on the Payout** (new table,
  `PayoutBalanceCheck`, one row per check, append-only). The Payout's status
  stays DRAFT/awaiting approval. No new Payout status. A refusal rolls back
  its own transaction, so the record is its own write, not part of
  `approvePayout`'s throw.
- **Q2 (who may clear it / who may record it):** any Admin other than the
  Payout's requester may record it -- the same rule as who may approve.
- **Q3 (resolution):** the pending decision is resolved automatically when
  the Payout is later approved with a sufficient balance; the "short"
  history rows stay as a trail, never deleted.
- **Q4 (what the Fundraiser sees):** "Menunggu saldo penyedia, dicek
  [tanggal]" for a Payout with an unresolved short check; the provider
  balance amount is **not** shown to the Fundraiser.

Built on `claude/ticket-30-balance-check`: `recordPayoutBalanceShort`
(`src/lib/money/payouts.ts`) refuses unless the Payout is DRAFT, refuses the
requester and the subject's own Fundraiser acting as Admin
(`requireNotOwnerAsAdmin`, the same judgement `approvePayout` makes), and
refuses a reading that is not actually short of the Payout's amount
(`ProviderBalanceNotShortError`, pointing the Admin at Setujui pencairan
instead). `approvePayout` itself is unchanged -- resolution is read off
`Payout.status`, never written by this ticket. The Admin route is
Payout-id-only (`POST /api/admin/payouts/[id]/balance-check`) since the
function never touches the ledger or a Campaign/Trip slug. The check history
shows on `/admin/payouts/[id]` (every status, newest first) and a queue
marker on `/admin/payouts`; the Fundraiser's line is on
`CampaignPayoutPanel`.
