---
status: accepted
---

# Fund for Indonesia holds two Merchant Accounts: YAYASAN and BADAN_USAHA

Extends [ADR 0011](0011-separate-merchant-account-from-makam.md), which settled that each platform holds its own merchant account and not one shared with Makam.co.id. It said nothing about what is inside a platform's account, and the PKS (Pasal 4.1(2) and 10(4)) requires the separation to be built, not just promised: money the yayasan collects for beneficiaries must be kept apart, in the books and at the provider, from the revenue of the operating company. The owner decided on 9 November 2026 that the separation is built inside FFI.

## Decision

Per platform there is still one gateway (Sumopod). FFI now holds **two merchant accounts at it**, named by `MerchantEntity` (src/lib/payments/merchant.ts):

- `YAYASAN`: donation, zakat, wakaf/hibah. The licence holder's account. Everything the Fundraising Permit covers.
- `BADAN_USAHA`: platform and commercial revenue: a Volunteer Trip fee an Admin marks commercial, and paid services added later. Never donated money.

### Routing is one pure function

`merchantEntityForPurpose(purpose)` maps what a charge is for to a merchant. A donation is `YAYASAN` and there is no input that changes that (the donation purpose carries no merchant or commercial field to set). `chargeDonation` calls it itself and refuses a provider bound to another merchant before anything is charged (`MerchantMismatchError`). A Trip Fee is `YAYASAN` unless marked commercial; the marking does not exist yet, so today every Trip Fee is `YAYASAN`. The merchant is stored on the Payment (`Payment.merchantEntity`).

### Credentials per merchant, with the old names falling back to YAYASAN only

Environment variables `SUMOPOD_<ENTITAS>_API_KEY`, `_WEBHOOK_SECRET`, `_BASE_URL`. `SUMOPOD_YAYASAN_*` falls back, variable by variable, to the pre-existing `SUMOPOD_API_KEY`, `SUMOPOD_WEBHOOK_SECRET`, `SUMOPOD_BASE_URL`, so production behaves exactly as before until the owner sets anything new. `SUMOPOD_BADAN_USAHA_*` has **no fallback**: with them unset, a commercial charge is refused (503 on the route, with the missing variable named in the log) and is never created on the yayasan's merchant. A missing credential must fail closed; a fallback that quietly sent commercial money to the yayasan is the quiet drift ADR 0011 was written to prevent.

### Webhooks are verified per merchant, and cannot cross

`/api/webhooks/[provider]` stays the URL already registered at Sumopod and is the `YAYASAN` merchant's. `/api/webhooks/[provider]/[merchant]` (`yayasan`, `badan-usaha`) gives each merchant its own endpoint. The merchant comes from the URL and selects whose webhook secret verifies the signature; a delivery signed with the other merchant's secret is a 401. After verification an event may only act on a Payment whose `merchantEntity` is the same: an event verified for `BADAN_USAHA` naming a `YAYASAN` Payment is answered 200 and does nothing, the same shape as the provider check beside it (200 so references cannot be probed, `processedAt` left null so a genuine event with that id still settles). Webhooks are never gated by the donation switch or maintenance mode: a payment already made must always be able to settle.

### The ledger is tagged

`LedgerEntry` gains `merchantEntity` (required, no default), `collectingEntityId` (the Partner Organisation collecting the money) and `actorId` (who caused the movement, PKS 4.3). `postTransaction` takes `merchantEntity` as a required option and refuses a missing one at runtime; a property test scans every call site. Settlements and the movements that follow a Payment (escrow release, refund legs) carry the Payment's own merchant. A Payout and the off-gateway movements (Manual Contribution, Campaign Transfer) are `YAYASAN` by `merchantEntityForPurpose`.

### Reconciliation and sweeps are per entity

`ProviderWithdrawal.merchantEntity` records which merchant's dashboard the Admin read. `/admin/reconciliation` and `GET /api/admin/reconcile` report pots, sweeps, divergence and the collection-account balance per entity (`providerReconciliation.byEntity`), beside the whole-account figures ADR 0011's invariant is stated over, which are their sum. Per entity is the only honest reading: a provider dashboard shows one merchant, and comparing it to a pot that also holds the other merchant's money would report a divergence that is not there.

### Backfill

Every ledger row that exists was a yayasan row. The migration backfills `YAYASAN` by adding the column `NOT NULL DEFAULT 'YAYASAN'` and then dropping the default. That is catalog metadata in PostgreSQL 11+: no row is rewritten and no UPDATE runs, so the `LedgerEntry_append_only` trigger is never disabled and the ledger is never mutable, even briefly. `Payment` and `ProviderWithdrawal` keep the `YAYASAN` default.

## Considered options

- Only this ADR, with the separation by process (two merchant accounts held by the owner, one used). Rejected by the owner: the PKS requires it built.
- One merchant account and an entity tag on the ledger only. Rejected: the money would still sit in one provider balance, and reconciling it against a dashboard that mixes both entities is what 0011 rejected for two platforms.
- A second provider (another gateway) for the operating company. Not needed: Sumopod supports several merchant accounts, and a second gateway would be a second integration for no separation the first does not give.
- Disabling the append-only trigger around an `UPDATE ... SET merchantEntity` backfill. Rejected as unnecessary: the column default does the same without ever making the ledger mutable.

## Consequences

- The owner opens the second merchant at Sumopod, registers `https://fundforindonesia.org/api/webhooks/sumopod/badan-usaha`, and sets `SUMOPOD_BADAN_USAHA_*`. Until then commercial charges are refused and nothing else changes.
- `Payout` movements are booked `YAYASAN`. If a commercial Trip Fee is ever paid out through the Payout module it would be booked to the wrong pot; that is a decision for when the commercial marking exists, not now.
- The Provider Balance invariant of ADR 0011 now holds per entity and, as the sum, for the whole account.
