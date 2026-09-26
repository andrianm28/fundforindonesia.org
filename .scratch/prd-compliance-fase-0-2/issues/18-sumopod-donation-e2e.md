# 18: Sumopod QRIS Donation end to end with frozen terms

**What to build:** A Donor gives real money by QRIS without an account, and the terms they were shown are the terms that apply no matter what an Admin changes afterwards.

**Blocked by:** 10, 17

**Status:** ready-for-agent

- [ ] A Guest Donor donates with email required, name and phone optional, and an anonymous option that hides them from the public and the Fundraiser
- [ ] Minimum Rp20.000, with quick amounts and a free amount
- [ ] Platform Fee, Provider Fee basis and Escrow Hold duration are copied onto the Payment at creation and shown before payment
- [ ] Provider Fee is read from the provider payload, never assumed
- [ ] A Payment expires after 24 hours; the Donor may retry with a new Payment on the same Donation, and at most one Payment ever settles
- [ ] A Demo Campaign and a non-Active Campaign both refuse Donations
- [ ] The donations kill-switch is removed once this path is proven
