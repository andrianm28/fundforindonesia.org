---
status: accepted
---

# Volunteer Trip stays a separate entity from Campaign, even though its Trip Fee now moves money

ADR 0002 kept Volunteer out of Campaign because no money moved. That stopped being true on 22 September 2026, when Volunteer Trip introduced a fee-based Registration model — inspired by the Traveling & Teaching program (1000 GURU Foundation), where a Volunteer pays to join a trip. We kept Volunteer Trip as its own entity anyway, reusing Payment, ledger, Escrow Hold, and Payout as shared money-movement primitives without treating the Trip Fee as a Donation or the trip as a fifth Campaign Kind. We chose this over adding `volunteer` as a fifth Kind (the obvious move once money is involved, and consistent with how Hibah was added in ADR 0013) because a Trip Fee is pure cost-recovery for the Volunteer's own participation, not a contribution to the destination community — calling it a Donation would misrepresent it in receipts and impact reporting, and would stretch every Kind-specific rule (Kind Authorisation, Platform Fee defaults, Refund eligibility) to cover a fundamentally different kind of payment.

## Considered options

- Add `volunteer` as a fifth Campaign Kind, matching ADR 0013's precedent. Rejected: the reasoning that justified folding Hibah into Kind — the differences from existing Kinds are rules, not structure — doesn't hold here. A Trip Fee's purpose (buying your own seat) is structurally different from every existing Kind's purpose (contributing to someone else's cause), and Kind Authorisation, Refund policy, and impact reporting all assume the latter.
- Keep Volunteer entirely separate, including its own payment and settlement code. Rejected: the underlying money mechanics — collect, hold, pay out to the Fundraiser, refund — are identical to Campaign's, so duplicating that machinery would just be Campaign's code copied under a new name with no functional difference.
- Separate entity, sharing Payment, ledger, Escrow Hold, and Payout as primitives, with no Kind or Donation vocabulary attached. Accepted.

## Consequences

- Volunteer Trip needs its own Fundraiser-moderation lifecycle mirroring Campaign's (draft, Verifier review, active), tracked on its own model rather than stored on Campaign. The exact states are not settled by this document.
- Refund on a Trip Fee does not follow ADR 0007's flat-Gross rule: it is tiered by time-before-departure when the Volunteer cancels, and full regardless of timing when the Fundraiser cancels a Batch for missing its minimum viable headcount. ADR 0007 stays exactly as written for Campaign; this is a deliberate divergence, not an oversight. Exact refund-tier thresholds and default minimum-headcount values are open, deferred to spec-writing (PRD pasal 13).
- `Program` already names CSR's non-money catalog item, predating this decision. To avoid two different entities both being called "the Program" in conversation, the money-moving entity here is named Volunteer Trip, not Volunteer Program, and its fee is Trip Fee, not Program Fee.
- ADR 0002's line "Volunteer Events are a separate entity because no money moves" is now only half true: the entity-boundary decision it made still stands, but the stated reason for it does not. ADR 0002 is left unedited as the historical record of that original decision; this document supersedes that one clause, not the ADR as a whole.
