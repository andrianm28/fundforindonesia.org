# 05: Playwright e2e in CI

**What to build:** Run the Playwright suite (`tests/e2e/`, `playwright.config.ts`) in CI against the built app and a Postgres service, on GitHub-hosted runners. This includes checking the privileged not-found view for unapproved Campaigns (verification-request 06), which unit tests cannot prove.

**Blocked by:** 01

**Status:** wontfix

- [ ] Decide scope and runtime budget first
