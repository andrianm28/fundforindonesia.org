# 05: Partnership Inquiry, created and notified

**What to build:** A company can submit a Partnership Inquiry about a Program,
and the partnership team is notified without a second notification mechanism
being invented.

**Blocked by:** 01 (Mailer itself is already built: prd-compliance-fase-0-2
ticket 13, done)

**Status:** done (PR #71, sha 3348ad5)

- [ ] `PartnershipInquiry` carries company name, contact details, a needs
      description, a follow-up status field, and a reference to the Program
      it's about
- [ ] `POST /api/partnership-inquiries` creates one against an existing
      Program; a Program id that doesn't exist is refused
- [ ] Creating a Partnership Inquiry sends a notification to the partnership
      team through the existing `Mailer` seam (`src/lib/mailer` or wherever
      ticket 13 landed it) — no second notification path
- [ ] The new Inquiry's initial follow-up status is a well-defined "not yet
      followed up" value, ready for ticket 06 to move it forward

## Comments

- 2026-09-27 (open question, not blocking): the partnership team's
  destination address isn't decided anywhere in the spec, CONTEXT.md, or the
  PRD. Treat it like `MAIL_FROM` in ticket 13 — a configuration value (e.g.
  `PARTNERSHIP_TEAM_EMAIL`) with no default that fails loudly if unset in a
  real-provider environment, mock Mailer used in dev/tests. Owner should
  supply the real address before this goes live; that does not block building
  or testing the route.
