# 03: Admin power comes only from the ADMIN assignment

**What to build:** Every place that grants Admin power from the legacy Role (`role === 'ADMIN'`, `isAtLeast(…, 'ADMIN')`) moves to the ADMIN assignment (ADR 0005). The places are: Campaign PATCH, the Trip, Batch and Batch-action routes, `admin/layout.tsx` and `admin/page.tsx`, and the `/admin` gate in the middleware. Someone with the old Role but no assignment is refused, and someone with the assignment but not the Role gets in. `withRoleCheck('CAMPAIGN_CREATOR')` and the `/moderasi` Role gate stay for prd-compliance tickets 06–08, each with a comment pointing there.

**Blocked by:** 02

**Status:** done

- [ ] No Admin grant via the legacy Role remains; the roles-expand guard asserts it
- [ ] Admin pages and the middleware `/admin` gate use assignments. Tests cover assignment-without-Role (allowed) and Role-without-assignment (refused)
- [ ] The routes above use the ADMIN assignment (through the Capacity judgement where it fits). Full suite green, tsc adds no errors
