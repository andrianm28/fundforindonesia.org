# 31: Refund completion (APPROVED -> COMPLETED) with proof of transfer

**Type:** implementation

**Status:** in-review

**Blocked by:** 23 (done) -- REQUESTED -> APPROVED must exist first; 13
(resolved) -- the proof-of-transfer shape this reuses.

## Why

Ticket 23 built only REQUESTED -> APPROVED and stopped there on purpose,
leaving `RefundStatus.COMPLETED` unreachable: an APPROVED Refund had no way
to actually pay the Donor. CONTEXT.md's own Refund entry already describes
the third step -- "diselesaikan Admin yang berbeda dari penyetujunya" -- and
`refundPaidLegs` (`src/lib/money/ledger.ts`) was written ahead of this
ticket specifically to receive it, its own doc comment naming ticket 32 (now
31) as "NOT POSTED YET... the reason it exists." Owner decision 2026-09-28
("ya semua" to Q5(a), `.scratch/rilis-1-benda/grilling-borongan-2026-09-28.md`):
an APPROVED Refund is completed by an Admin with a transfer proof
(transaction reference + note, same rule as Payout completion, ticket 13),
after the Admin transfers by hand to the Donor's account, whose details the
Admin records manually on completion.

## Decision / scope

`completeRefund` in the money layer, APPROVED -> COMPLETED only, mirroring
`completePayout`'s two-person discipline:

- Refuses anything that is not APPROVED (`InvalidRefundStatusError`, same
  class ticket 23's `approveRefund` already throws for its own status gate).
- Refuses the Admin who REQUESTED the Refund and the Admin who APPROVED it
  (`TwoPersonRuleError`, generalized from `completePayout`'s single-check
  version -- a Refund names three people, not two, so this is checked
  twice, not once).
- Validates the transfer proof (transaction reference + free note) through
  the exact `validateProofReference`/`validateProofNote` functions
  `completePayout` already asks (`@/lib/payout-proof`, ticket 13) -- one
  validator, now three callers (Payout, and this).
- Records the Donor destination the Admin typed by hand: bank code, account
  holder name, and account number. There is no saved BankAccount row for a
  Donor (CONTEXT.md, Bank Account), so this is recorded fresh, on three new
  nullable columns on `Refund` (`donorBankCode`, `donorAccountName`,
  `donorAccountNumberCiphertext`/`donorAccountNumberKeyId`) -- the smallest
  honest option, rather than a new table nothing else needs yet. The number
  is sealed with the same field encryption as `BankAccount.accountNumber`
  (`sealBankAccountNumber`'s underlying `seal`/`read` plumbing in
  `src/lib/contact-fields.ts`), under its own AAD
  (`Refund.donorAccountNumber`, not `BankAccount`'s), and is never rendered
  back in full on any screen.
- Posts `refundPaidLegs` (`src/lib/money/ledger.ts`, already written): DEBIT
  REFUND_CLEARING / CREDIT GATEWAY_CLEARING for the full Gross -- the exact
  legs PRD §7.2's "Pencatatan" section describes for completion ("Saat
  selesai, kliring refund didebit dan saldo penyedia dikredit sebesar
  Gross"), and ADR 0007's reason the full Gross (not the Campaign's net
  share) is what leaves the Provider Balance.
- Thin routes, `POST /api/campaigns/[slug]/refunds/[id]/complete` and
  `POST /api/volunteer-trips/[slug]/refunds/[id]/complete`, both
  `withAssignmentCheck(Assignment.ADMIN)`, mirroring the approve routes'
  Campaign/Trip scoping split.
- `/admin/refunds/[id]` grows a complete form (`AdminRefundCompleteForm`)
  when the Refund is APPROVED, showing the two-person notice instead when
  the viewer is the requester or the approver; `/admin/refunds` lists
  APPROVED Refunds under a second "Menunggu penyelesaian dengan bukti"
  queue, mirroring `/admin/payouts`'s two-queue shape.

Out of scope, staying deferred exactly as ticket 23 left them: AwaitingDonorDetails
and the signed 30-day donor-details link, Processing as its own status (folded
into this one completion step, same as Payout), Rejected, and Failed.
Creating a Trip Fee Refund from a screen (rather than this API) is ticket 29's
scope, gated with its other Volunteer Trip screens on Fase 3 -- see ticket 29's
own note (Q6, owner 2026-09-28).
