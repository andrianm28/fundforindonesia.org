# 09: An Active Campaign's title and description are frozen

**What to build:** On an ACTIVE Campaign, `PATCH /api/campaigns/[slug]` accepts only story and cover image. A title or description in the body is refused with 409, a typed code and an Indonesian message; the edit is not silently dropped. DRAFT and REJECTED still accept all four content fields. SUBMITTED and final statuses are refused as today (ticket 05). This is stricter than PRD FFI-05, on purpose (CONTEXT.md, Verification Request), so add a note to PRD §13 (open questions and decisions) recording it.

**Blocked by:** 05

**Status:** in review (PR #47)

- [ ] ACTIVE: a story or cover edit succeeds; a title or description edit is refused (typed 409), and nothing is written
- [ ] DRAFT and REJECTED: all four fields editable. Other statuses unchanged
- [ ] The rule lives next to `requireContentEditable` in the subject guard. Route tests cover each field × status
- [ ] PRD §13 records the deviation. Full suite green, tsc adds no errors
