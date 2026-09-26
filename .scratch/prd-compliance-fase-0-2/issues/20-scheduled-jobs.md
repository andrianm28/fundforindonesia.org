# 20: Scheduled jobs and escrow release on a schedule

**What to build:** Matured money becomes available on time, whether or not a Fundraiser happens to request a Payout, and time-based reminders start working.

**Blocked by:** 19

**Status:** ready-for-agent

- [ ] A single scheduled entry point takes the current time as an argument and is driven directly in tests, never through timers
- [ ] Matured Escrow Hold releases to Campaign Balance on schedule, with the existing lazy sweep kept as a second path
- [ ] Campaign deadline reminders and Kind Authorisation expiry warnings run here
- [ ] The sweep remains bounded and idempotent, and one failing payment cannot stop the rest
