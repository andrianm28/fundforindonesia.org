# 01: Sumopod payment and mail credentials in the production environment

**What to build:** Before prd-compliance 18 (a real QRIS Donation end to end) and 21 (Receipt), the owner puts these into the production `.env` on the host, in the deploy directory created by ci-cd 08:
- the Sumopod payment API key;
- the webhook secret;
- the base URL;
- the SMTP relay credentials (host `smtp.sumopod.com`, port 465, username, password, `MAIL_FROM`, e.g. `no-reply@fundforindonesia.org`).

The owner also registers the production webhook URL in the Sumopod dashboard.

**Blocked by:** ci-cd-github-actions 08 (cutover)

**Status:** ready-for-human

- [ ] The payment key, webhook secret and base URL are set, and the webhook URL is registered
- [ ] SMTP credentials are set; a test email from the app reaches an external inbox with SPF, DKIM and DMARC passing
