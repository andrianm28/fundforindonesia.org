# 10: Suspended Hibah Campaign transfers within Kind, cross-Kind refused

**What to build:** A suspended `hibah` Campaign's funds move to another
Campaign of Kind `hibah`, never refunded to Donors, using the exact same
transfer mechanism the parent spec already builds for `zakat`/`wakaf` — no new
transfer logic.

**Blocked by:** cross-feature `prd-compliance-fase-0-2 33` (kind-transfer;
not built as of this spec)

**Status:** done (PR #199, 55ab170)

- [x] A suspended `hibah` Campaign transfers its funds to another Campaign of
      Kind `hibah`, via the same balanced-journal, two-person-rule transfer
      ticket 33 builds
- [x] A cross-Kind transfer out of or into a `hibah` Campaign is refused
      outright, not warned about — same as `zakat`/`wakaf`
- [x] Every affected Donor Hibah is told where their money went
- [x] Regression test named in the spec: a suspended `hibah` Campaign's
      transfer refuses a cross-Kind destination outright, matching the
      existing zakat/wakaf behaviour

## Comments

- 2026-09-27 (ticket-writing): do not start before `prd-compliance-fase-0-2
  33` lands. That ticket's own scope note says it's built because "the
  suspension rule cannot work without it" — this ticket just proves `hibah`
  reuses the same mechanism `wakaf`'s category-matching variant already
  establishes there.
- 2026-10-03 (`claude/csr-10-hibah-suspension-transfer`): blocker `prd-compliance-fase-0-2 33` is done on main (PRs #191 and #198), so this ticket was unblocked. Implemented by extending `src/lib/money/campaign-transfers.ts`: the hardcoded zakat/wakaf list became a total `Record<Kind, rule>` (like the refund table), with `hibah` transferable to `hibah` only. No new journal, lock, two-Admin, full-amount-recompute (409) or refund-after-transfer logic; Hibah goes through all of it unchanged, including follow-up transfers. Cross-Kind into or out of hibah is refused outright by `judgeCampaignTransfer` at request and at approval. Donor email now names the Kind (was hardcoded "Zakat dan Wakaf"). The `CampaignTransferKindNotTransferableError` message and CONTEXT.md (Campaign Transfer) updated; only `donation` is now non-transferable. Tests: unit (request, approve, self-approval, balance changed, re-judge at approval, cross-Kind matrix incl. hibah) and real-DB (hibah happy path, cross-Kind at request and approval).
- 2026-10-03 OWNER DECISION PENDING: the ticket says only "another Campaign of Kind `hibah`", so Hibah has NO Category match (unlike Wakaf). CONTEXT.md says Hibah is not bound forever like Wakaf, and ADR 0013's Wakaf-copy covers Kind Authorisation, Refund and fee, not transfer. If the owner wants Hibah category-bound, flip `sameCategory` for `HIBAH` in `TRANSFER_RULE_BY_KIND` (one line) and adjust the one test.
