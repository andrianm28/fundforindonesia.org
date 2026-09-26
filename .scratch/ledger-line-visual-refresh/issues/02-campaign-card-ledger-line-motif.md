# 02: Campaign card — the Ledger Line motif

**What to build:** A Donor browsing the campaign listing or explore pages sees
each campaign card's progress bar carry the platform's signature "this claim is
backed by a record" visual — the Ledger Line — instead of a flat two-tone bar.
The line renders as a dashed gold rule (a `repeating-linear-gradient` CSS
background, not an image or SVG) with milestone ticks fixed at 25/50/75% for
every campaign, regardless of that campaign's real disbursement history — this
is a promise about the platform's process ("we disburse in stages"), not a
report on this specific campaign, since no disbursement-ledger page exists yet
to hold the real, record-backed account (see ticket set's Out of Scope). The
`ledger` gold token introduced in ticket 01 is used here and, in this whole
ticket set, nowhere except this motif.

**Blocked by:** 01

**Status:** done

- [ ] `src/components/campaign/CampaignCard.tsx`'s progress bar renders the
      Ledger Line motif (dashed gold line) with milestone ticks at fixed
      25/50/75% positions, replacing the current flat two-tone bar.
- [ ] The `ledger` color token is used for this motif and nothing else in this
      component — no button, badge, or other element on the card picks up the
      gold token.
- [ ] `CampaignCard.test.tsx` and `CampaignCardSkeleton.test.tsx` still pass,
      updated only where they assert on the old bar's specific markup/classes
      — the underlying behavior (does the bar reflect the right percentage) is
      still asserted, not weakened.
- [ ] Verified in-browser on the campaign listing/explore page: the motif
      renders correctly at a range of real progress percentages (e.g. a
      campaign near 0%, one past 75%, one that has met its target).
