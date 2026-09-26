# 04: Campaign creation — Record-register progress indicator

**What to build:** A Fundraiser going through campaign creation senses, from
the first step, that what they're building will later be held to account —
their progress through the flow is shown via a slim, numbered indicator set in
the Record register (small caps, ticket 01's serif/mono pairing as
appropriate), the same discipline `ffi`'s sibling design applies to its own
(differently-shaped) creation wizard. This repo's campaign creation is
currently a single page/form, not a multi-step wizard with one route per step
— read the real current structure first and adapt the "numbered progress"
*idea* to however this flow is actually organized (sections within one page,
a client-side step state, or whatever it turns out to be), rather than forcing
a step-per-route shape that doesn't match this codebase.

**Blocked by:** 01

**Status:** done

- [ ] `src/app/campaign/create/page.tsx`'s actual current structure (single
      page vs. sectioned vs. client-side multi-step) is read and documented
      before any change, so the progress indicator's shape is a real decision,
      not an assumption carried over from `ffi`'s wizard.
- [ ] A progress indicator is added, numbered, set in the Record register,
      reflecting genuine, ordered progress through whatever this page's real
      structure turns out to be — numbering must be honest (a real ordered
      sequence), not decorative.
- [ ] The indicator does not imply more steps exist than actually do, and does
      not break if the page's structure doesn't cleanly map to a fixed step
      count (e.g. conditional sections).
- [ ] Verified in-browser: creating a campaign end-to-end, the indicator
      reflects real progress at each stage.
