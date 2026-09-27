# 21: Receipt by email and print page

**What to build:** A Donor receives proof of their gift and can reopen and print it later.

**Blocked by:** 13, 18

**Status:** done

- [x] A Receipt reaches the Donor's email after Settlement, including a Guest Donor
- [x] A print page is reachable from the email and from the dashboard
- [x] The Receipt names the Collecting Entity as the body that received the money, not the platform
- [x] A Donor can request the Receipt be sent again

## Comments

Implemented in PR #52 (branch `claude/ticket-21-receipt`): new `Receipt` model +
migration, `src/lib/receipt-token.ts`, `src/lib/mail/receipt.ts`, the
settlement webhook now creates the Receipt and emails it, a resend endpoint
at `src/app/api/receipts/[token]/resend/route.ts`, a public print page at
`src/app/receipt/[token]/page.tsx`, and a dashboard link from
`src/app/donasi-saya/page.tsx`. Full suite, tsc and lint all at or under
`ci/baselines.json`; `npm run ci:local -- test ratchet` green. Reviewed with
`/code-review` (parallel Standards + Spec); findings (resend not checking
delivery, duplicated recipient-resolution logic) fixed before this push.
Merged to `main` (PR #52, merge commit c3e98ef).
