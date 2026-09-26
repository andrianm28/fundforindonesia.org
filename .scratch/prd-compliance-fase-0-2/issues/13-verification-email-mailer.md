# 13: Verification outcome email, and the Mailer seam

**What to build:** A Fundraiser finds out by email whether their Campaign passed, and why if it did not. This is the Fase 0 exit gate: a verification decision that never reaches the Fundraiser is not a decision. It also establishes how this platform sends email at all.

**Blocked by:** None (12 satisfied by verification-request 02)

**Status:** done (PR #19, 32ffdd9)

- [ ] A Mailer interface with a registry and a mock implementation, mirroring the payment provider pattern: mock by default, real provider behind configuration, loud failure when unconfigured rather than a silent no-op
- [ ] Approval and rejection both reach the Fundraiser by email, rejection carrying its reason
- [ ] Tests assert what the Mailer was asked to send; no test performs network I/O
- [ ] A failure to send is visible to an operator, never swallowed

## Comments

- 2026-09-26 (status tidy): Real provider decided: SMTP to the Sumopod relay (smtp.sumopod.com:465, smtps), which fundforindonesia.org is already authenticated for (SPF include:spf.kirim.email, DKIM selector trx_ke, sumo-verification; see /home/ubuntu/mail-setup/RELAY-fundforindonesia.md). Stalwart on this host handles inbound only; direct sending is blocked by missing rDNS. Credentials come from the production .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM such as no-reply@fundforindonesia.org). Mock stays the default in dev and tests. Blocked-by 12 is satisfied by verification-request 02.
