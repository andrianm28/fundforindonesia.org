# 02: Every "only the owner" check asks the Capacity judgement

**What to build:** About nine routes hand-write their own "only the owner may…" check, each with a different 403 text. They are: Campaign PATCH, Campaign Updates, Campaign and Trip Payout request, Trip PATCH, Batch create, and the Batch actions. They now ask the Capacity judgement for the FUNDRAISER Capacity. Every such refusal then gets code `NOT_AUTHORIZED` and a consistent Indonesian message through the shared refusal mapping. The ownership read happens where the route already reads the subject; routes that go on to call a money operation keep the operation's own check under the lock.

**Blocked by:** 01

**Status:** done

- [ ] Each listed route refuses a non-owner with 403 `NOT_AUTHORIZED` and an Indonesian message, and the owner still succeeds
- [ ] No route hand-writes an owner comparison for these actions any more; a static guard or grep test pins it
- [ ] Route tests are updated to assert the code. Full suite green, tsc adds no errors
