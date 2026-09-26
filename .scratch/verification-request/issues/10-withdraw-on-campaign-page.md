# 10: "Tarik pengajuan" on the Campaign page

**What to build:** While a Verification Request is pending, the Fundraiser, viewing their own Submitted Campaign through the privileged not-found view from ticket 06, sees a "Tarik pengajuan" button that calls the withdraw route from ticket 03. "Kampanye Saya" already has it. Nobody else sees it.

**Blocked by:** 03, 06

**Status:** done (PR #48, e713cde)

- [x] The Fundraiser sees and can use the button on their Submitted Campaign's page; Verifiers, Admins and others do not see it
- [x] After a withdraw the view shows the new status (Draft or Rejected)
- [x] Full suite green, tsc adds no errors
