# 03: The Terms stop promising that Campaigns get deleted

**What to build:** The Terms page (`src/app/(static)/terms/page.tsx`, the Campaign section) says: "Kami berhak menolak, menangguhkan, atau menghapus kampanye yang melanggar ketentuan ini…". Since ADR 0016, Campaigns are never deleted. A Campaign that breaks the rules is Rejected at verification or Suspended, and a Suspended Campaign stays visible by link with a neutral banner. The legal copy should say what the platform actually does. This is legal text, so a human (the Platform Operator or its legal counsel) decides the wording.

Suggested wording for review, not binding: "Kami berhak menolak kampanye pada tahap verifikasi, atau membekukan (Suspension) kampanye yang melanggar ketentuan ini, termasuk namun tidak terbatas pada…".

Related stale copy flagged in the PRD/ADR analysis (§1a, C2 remainder), for the same reviewer:
- `src/app/(static)/help/page.tsx:48-56` ("selesai secara instan" for verification)
- the FAQ accordion
- `terms/page.tsx:56` (verification before creating a Campaign)

Also check whether the Terms should say that Donations stop and Refunds may be made on Suspension (PRD §7.2).

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [ ] The Platform Operator or legal counsel approves the new Campaign-section wording
- [ ] The Terms page is updated and no longer promises deletion
- [ ] The stale verification copy listed above is reviewed in the same pass
