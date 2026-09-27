# 11: Playwright e2e in CI

**Blocked by:** 02

**Status:** done (PR #66, 8e15f88)

- [ ] Scope decided: the privileged not-found view (verification-request 06) plus the QRIS donation flow through Receipt, which unit tests can't prove

## Comments

- 2026-09-27 (needs-info resolved): owner chose "VR-06 + donasi" — e2e covers the privileged not-found view plus one real donation path (QRIS → settled → Receipt). Blocker 02 is done.
- 2026-09-27 (status corrected): PR #66 implemented this and merged, but never
  touched this file, so the ticket stayed `ready-for-agent` after the work
  landed. Found by comparing every `ready-for-agent` ticket against the PRs
  that touched it, which is a check this tracker did not have.
