---
status: accepted
---

# Hibah is a fourth Campaign Kind, provisionally governed like Wakaf

Hibah — a directed gift or grant to an institution or a named purpose — becomes a fourth Kind alongside `donation`, `zakat`, and `wakaf`, decided 22 September 2026 to replace Volunteer's primary menu slot. Money for Hibah moves through the same Campaign, Payment, ledger, escrow, and payout machinery every Kind already shares (ADR 0002); nothing about ADR 0002's boundary changes. We chose a fourth Kind over a separate entity because the differences between Hibah and the existing Kinds are rules — fee, required documents, Kind Authorisation, refund eligibility — not structure, which is exactly the reasoning ADR 0002 already established for Zakat and Wakaf.

What this ADR does **not** settle: the specific rules Hibah should carry. Zakat and Wakaf's refund block and Kind Authorisation requirement exist because of real, checked facts about those instruments — a fulfilled zakat obligation and a sworn waqf pledge do not return to the giver. No equivalent check has been done for Hibah. Rather than leave Hibah's rules undefined, which would block shipping it as a Kind at all, we copy Wakaf's treatment as a **stated placeholder**: Kind Authorisation required, Platform Fee default zero, Refund permitted only on technical failure (wrong payment, double payment, funds arriving after closure). This is a deliberate stand-in, not a researched conclusion, and it is recorded as an open risk (PRD §12) precisely so it gets revisited before Hibah takes real donations.

## Considered options

- Treat Hibah like plain `donation` (no Kind Authorisation, ordinary refund eligibility). Rejected for now: if Hibah is in fact closer to Wakaf in practice — an institutional grant that, once given, is not ordinarily reversible — this would wrongly let donors reclaim gifts that shouldn't be reclaimable, and would let any registered Fundraiser open a Hibah Campaign without institutional vetting.
- Leave Hibah unshippable until fiqh guidance is obtained. Rejected: the fourth-Kind decision itself doesn't depend on the answer, and blocking all of Hibah on a legal review neither this document nor the codebase can perform would stall work that doesn't need to wait.
- Copy Wakaf's rules as a placeholder, flagged explicitly as provisional. Accepted.

## Consequences

- Kind Authorisation for `hibah` is Verifier-granted and dated, exactly like `zakat`/`wakaf`; an individual Fundraiser cannot open a Hibah Campaign.
- Refund on `hibah` is blocked for ordinary cases and permitted only for wrong payment, double payment, or funds arriving after Campaign closure — the same carve-out as Zakat and Wakaf.
- If a review finds Hibah's real-world reversibility or licensing requirements differ from Wakaf's, every one of these rules — the refund gate, the authorisation requirement, the document checklist — needs revisiting in the money layer, not just in this document. The cost of being wrong here is the same class of cost as getting Zakat or Wakaf's rules wrong: a real refund wrongly refused, or one wrongly allowed.
- CONTEXT.md and the PRD both mark this as a stated assumption, not settled fact, so a future reader correcting it is expected, not a surprise.
