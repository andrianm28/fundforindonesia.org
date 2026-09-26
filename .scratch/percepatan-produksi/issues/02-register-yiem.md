# 02: Register YIEM as the first Partner Organisation, with its permit

**What to build:** Once prd-compliance 10 is deployed, a Verifier registers Yayasan Indonesia Emas Merdeka (YIEM) as a Partner Organisation, using its real legal documents:
- link YIEM's Fundraiser account;
- record its Fundraising Permit (number, issuer, Kinds, validity);
- decide whether it accepts individual Campaigns;
- assign it as the Collecting Entity of the existing Active Campaigns that belong to it.

This must be done before donations are switched on.

**Blocked by:** prd-compliance 10, and the deploy after ci-cd 08

**Status:** ready-for-human

- [ ] YIEM is registered with its real permit data, which the owner supplies
- [ ] Every Active Campaign has a Collecting Entity; none is left refusing donations by accident
