# 39: Second payment provider enabled from the dashboard

**What to build:** An Admin can switch on another provider, bringing virtual account and e-wallet payments, without a deploy.

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] Providers and their methods are enabled from the Admin panel
- [ ] Every Payment records its provider and reference
- [ ] Each provider verifies its own webhook signature through the existing provider interface
- [ ] Reconciliation and reporting already run per provider
- [ ] The merchant account is this platform's own and is never shared with another platform in the group, per ADR 0011
