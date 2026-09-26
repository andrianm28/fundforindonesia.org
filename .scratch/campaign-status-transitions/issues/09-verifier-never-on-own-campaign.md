# 09: A Verifier never acts as Verifier on their own Campaign

**What to build:** The rule that an Admin never acts as Admin on a Campaign they own (CONTEXT.md, Admin) now also covers the Verifier (CONTEXT.md, Verifier), in line with ADR 0005. A person holding the VERIFIER assignment who is also a Campaign's Fundraiser cannot raise a Flag on it, and cannot approve or reject its submission. Everyone else is unaffected.

**Blocked by:** 06

**Status:** done

- [ ] `flagCampaign` refuses the Campaign's own Fundraiser with the own-Campaign conflict (403), even when they hold VERIFIER
- [ ] `decideSubmission` (moderation approve/reject) refuses the Campaign's own Fundraiser the same way, with no status change, no log row and no notification
- [ ] The existing `requireNotOwner` helper is reused. Where the refusal message mentions Admin, it is worded so it also fits a Verifier (Indonesian, glossary terms)
- [ ] Tests at both seams: the lifecycle module and the Flag and moderation routes
