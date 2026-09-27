# 06: Partnership Inquiry follow-up by the partnership team

**What to build:** A member of the partnership team can see and update a
Partnership Inquiry's follow-up status.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] `PATCH /api/admin/partnership-inquiries/[id]` moves the follow-up status
      forward (e.g. not-yet-followed-up → in-progress → done), Admin/partnership
      team only
- [ ] A list view shows every Partnership Inquiry with its Program, company
      name, and current status
- [ ] Every status change records who and when
