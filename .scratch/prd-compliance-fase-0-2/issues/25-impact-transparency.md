# 25: Impact & Transparency six-line breakdown

**What to build:** A visitor sees where every rupiah is, in six lines that add up exactly to the amount collected, computed from the ledger rather than from display figures.

**Blocked by:** 17, 20

**Status:** ready-for-agent

- [ ] Collected is Gross of settled Payments plus Manual Contribution, excluding Demo Campaigns and reversed contributions
- [ ] The six lines sum exactly to collected, and the page fails loudly rather than showing numbers that do not reconcile
- [ ] A refunded Donation still counts as collected and appears as a returned line
- [ ] Platform cost items appear separately, because they are platform money and not part of collected
- [ ] Beneficiary counts come from Usage Reports, and read zero until those exist
- [ ] Filterable by location
