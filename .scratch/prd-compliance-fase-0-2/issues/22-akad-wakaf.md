# 22: Akad Wakaf per Donation

**What to build:** A Wakif receives the pledge document their practice requires, generated per Donation and sent with the Receipt.

**Blocked by:** 11, 21

**Status:** in review (PR #54)

- [x] Checkout on a wakaf Campaign carries an explicit ikrar confirmation, not an assumed one
- [x] An Akad Wakaf is produced per Donation carrying the Wakif's name, the amount, the purpose and the nazhir
- [x] It is sent alongside the Receipt and reopenable in the same way

## Comments

Implemented in PR #54. Two things this ticket and CONTEXT.md leave undefined,
flagged rather than invented (ADR 0010 says the Akad names the Collecting
Entity, but not these):

- **Peruntukan (purpose)**: mapped to the Campaign's `title` -- no separate
  purpose field exists anywhere in the schema or PRD.
- **Ikrar wording**: the checkbox text is a plain confirmation, not a formal
  syariah ikrar formula. Needs review before it reaches a real Wakif.
