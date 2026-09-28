# 30: Admin records "checked, short" as a pending decision when the provider balance is too low

**Type:** implementation

**Status:** open

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
