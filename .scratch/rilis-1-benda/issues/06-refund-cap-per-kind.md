# 06: Is a Refund capped per Kind, and which Kinds?

**Type:** grilling

**Status:** resolved

## Question

FFI-08b says `hibah` "for now follows the same Refund bound as `wakaf`" —
and **there is no such bound anywhere**. `src/lib/money/refunds.ts` does not
import `Kind` at all, so a `zakat`, `wakaf` or `hibah` Donation can be
refunded on a manager's decision alone.

So the question was three parts: whether a bound is uniform, whether it is
per Kind, and whether it must be settled before Release 1.

## Answer

Settled by the owner on 2026-09-27, in the intake grilling for the
`rilis-1-benda` map:

**One uniform bound for `zakat` and `wakaf`. No bound for `hibah`. Decided
now, not deferred.**

The reasoning behind each half, as it was given:

- **`zakat` and `wakaf`** carry obligations that do not hold for an ordinary
  Campaign — funds given under a specific religious instrument. Letting them
  be refunded at a manager's discretion is a defect, not a setting.
- **`hibah`** is deliberately different for now. ADR 0013 and PRD §12
  §14 place it under a sharia review that has not happened, and FFI-08b
  already says it copies `wakaf`'s documents pending that review. A bound is
  therefore not imposed on it now, on the same footing as the other two
  rather than as an oversight.

**What this does not decide**, and what a later session must not assume:

- The number. Neither "the same as `wakaf`'s" nor "the same as ordinary
  Campaigns'" has been chosen, and the two are not the same. This needs a
  value and a reason before it can be built.
- Whether a bound that is hit **refuses the refund** or records it and
  allows it. Undecided, and the same gate-or-observation question as
  `02: Where is the provider's real balance recorded`.
- How a bound interacts with a **partial** refund: is the cap on the total
  refunded over a Payment's life, or on any one request? `refunds.ts` already
  computes a cumulative `remaining`, so the natural reading is cumulative,
  but it is not stated anywhere.
- Whether the bound is **Admin-configurable** or a constant. That is part of
  `04: Are the PRD's numbers defaults in code, or configuration?`, and the
  answer here should follow that one rather than pre-empt it.

The Refund lifecycle itself is still missing most of its steps — the code
only produces `REQUESTED` and `APPROVED` — so this bound has nowhere to live
until `prd-32` builds the rest of the cycle.
