# 39: Second payment provider enabled from the dashboard

**What to build:** An Admin can switch on another provider, bringing virtual account and e-wallet payments, without a deploy.

**Blocked by:** 18

**Status:** done (PR #195, 96c1c87)

- [x] Providers and their methods are enabled from the Admin panel (`/admin/payment-providers`, `POST /api/admin/payment-providers`; only providers registered in this build and configured in the environment)
- [x] Every Payment records its provider and reference (already true; pinned again by the e-wallet donation route test)
- [ ] Each provider verifies its own webhook signature through the existing provider interface
- [x] Reconciliation and reporting already run per provider (unchanged)
- [x] The merchant account is this platform's own and is never shared with another platform in the group, per ADR 0011

## Comments

- 2026-10-02 (agent, branch `claude/prd-39-second-provider`). What is built is the
  seam, not a second real provider. `docs/integrasi-sumopod.md` says Sumopod is
  QRIS only, and no other provider's API (Midtrans, Xendit, DOKU) can be verified
  from here, so no adapter and no endpoint were invented.
  - `PaymentProviderSetting` (migration `20261003010000`), append-only like the
    other Admin settings: latest row = provider + enabled methods in force; no
    row = `PAYMENT_PROVIDER` with all of that adapter's methods, so nothing
    changes until an Admin acts. Resolved by `resolveActivePaymentProvider`
    (`src/lib/payments/active-provider.ts`) in the donation route, its retry and
    the Trip Fee route/page.
  - `PaymentMethod` gains `ewallet_redirect`; donor choice `ewallet` now maps to
    it; `PaymentProvider.supportedMethods` (optional, default `[method]`) lets an
    adapter declare several, and `ChargeInput.method` tells it which. Today no
    adapter declares e-wallet or VA beyond the mock, so e-wallet is still refused
    with 503 until a real adapter lists it.
  - Setting refuses (400/409, writes nothing): unknown provider or method, a
    method the adapter does not support, a provider with missing credentials, and
    the mock or a sandbox in production. The same production refusal runs again at
    charge time. The existing env-based `sandboxInProductionReason` still runs
    first, so in production `PAYMENT_PROVIDER` must itself be a live provider.
  - Webhook is untouched: provider comes from the URL (#179 mismatch check) and
    late settlement (#180) stays; route tests pin that, with the setting naming A, a webhook to B still settles and a mismatch is still refused; the route never reads the
    setting, so a switch cannot strand a Payment made before it.
  - Credentials stay env-only; `.env.example` has no new values. The route stores
    only provider, methods and the Admin (test).
  - `POST /api/admin/payment-providers` is ADMIN via `withAssignmentCheck` and is
    in `roles-expand-guard.test.ts`.
  Waiting on the owner: which second provider (and its sandbox account/API docs).
  Its adapter then needs: a name in `PAYMENT_PROVIDER_NAMES`, a builder in
  `index.ts`, a production rule in `production-readiness.ts`, its own webhook
  signature verification in `parseWebhook`, `supportedMethods`, and its env vars
  (empty in `.env.example`). The third acceptance item (that provider verifying
  its own signature) stays open until then. Also open: `GATEWAY_CLEARING` is
  still one account for all providers (ADR 0011 update note), so a second
  provider's settlements would share that pot until that is split.
- 2026-10-03: done. Merge ke main sebagai 96c1c87. AC 3 (provider webhook signature verification) dan pemisahan GATEWAY_CLEARING menunggu owner memilih provider kedua.
