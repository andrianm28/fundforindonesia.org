# 04: Public CSR portfolio and Program detail pages

**What to build:** A CSR team can browse Programs grouped by Sector and read
a Program's full detail without a proposal being written from scratch.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `GET /api/programs` lists Programs grouped or filterable by the four
      fixed Sectors
- [ ] `GET /api/programs/[slug]` returns one Program's problem, target
      beneficiaries, location, activities, budget, timeline, KPIs,
      documentation, and impact report
- [ ] The portfolio page shows a Sector card for each of Health, Education,
      Environment, Disability Inclusion
- [ ] The Program detail page shows every field above plus a "Discuss with
      Our Team" action that opens the Partnership Inquiry form (ticket 05)
- [ ] Neither route nor page ever surfaces a Donation control, a payment
      method, or anything implying a Program takes money online
