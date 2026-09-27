# 05: What does a person holding two assignments see?

**Type:** grilling

**Status:** open

## Question

ADR 0005 removed rank: a role no longer implies a permission, and a
Permission is an **assignment** — ADMIN, VERIFIER, FUNDRAISER, DONOR are
separate things a person may hold at once. The code already lives in that
world: `src/lib/capacity.ts` and the assignment guard tests exist because of
it.

Nothing has answered what that means for a **screen**. An Admin who is also a
Verifier is not a hypothetical — an organisation's operations person is
exactly that, and a Fundraiser who is also a Verifier is reachable in a
twelve-person team. Today every page under `src/app/admin` and
`src/app/moderasi` guards on its own assignment, so such a person gets both
sets, and:

1. **Is that right?** An Admin-Verifier reviewing a Campaign can approve the
   submission and administer the Verifier who is meant to check it. FFI-07's
   two-person rule says the Completer must differ from the Approver and from
   the Fundraiser — it says nothing about a third relationship, and the
   subject guard only knows assignments.

2. **Or should some screens be exclusive?** A Verifier who administers the
   Verifier list is approving their own colleague's assignment.

3. **What does a person see in the navigation?** Today the two trees are
   separate, which is a crude answer to a question the domain has not
   asked.

This is not a small thing to leave open: it shapes every page in the
product, and every page is the thing this map is trying to make exist. It is
listed under fog as well, because whether it is one rule or several is not
yet sharp — but it is a question, so it is a ticket.
