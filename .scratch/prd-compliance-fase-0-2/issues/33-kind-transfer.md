# 33: Campaign-to-campaign transfer for zakat and wakaf suspension

**What to build:** When a zakat or wakaf Campaign is suspended, its funds move to another Campaign of the same Kind rather than returning to Donors, which is the rule the platform currently has no way to honour.

**Blocked by:** 11, 30, 32

**Status:** ready-for-agent

- [ ] Zakat and wakaf are not refundable by management decision, only on technical failure: wrong payment, double payment, or money arriving after closure
- [ ] A suspended zakat or wakaf Campaign transfers its funds to another Campaign of the same Kind, and for wakaf the same category
- [ ] A cross-Kind transfer is refused outright, not warned about
- [ ] The transfer is a balanced journal under the two-person rule, never a balance edit
- [ ] Every affected Donor is told where their money went
- [ ] Built here because the suspension rule cannot work without it; Dormant Balance handling reuses this mechanism later
