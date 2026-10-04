# 08: Does a Tim CSR get an account of its own?

**Type:** grilling

**Status:** resolved

**Built by:** [E9 tim-csr-account](../../fase-3-perluasan/issues/01-tim-csr-account.md)

## Question

PRD §4 lists "Perusahaan atau tim CSR" among the target users, with needs a
portfolio of Programs by Sector, budgets and KPIs, and a Partnership Inquiry.
The glossary had no term for that actor at all — `Program`'s definition said
"dibaca tim CSR perusahaan" and left the reader dangling.

The question was whether they are a role at all, and if so whether they get an
account, because an account means storing a company's contact details and a
per-company thread of follow-up, and no account means the acknowledgement is
an email and nothing more.

## Answer

Settled by the owner on 2026-09-27.

**A Tim CSR gets its own account, and it is in Rilis 1.**

**Tim CSR is a term, not an Assignment.** This is the load-bearing part. An
account here does not grant a role: it carries no Campaign, no Payout and no
Verification Request. Someone who is a Tim CSR and later opens their own
Campaign holds both things at once, and neither displaces the other. Roles come
from an `Assignment`, and a `Tim CSR` account adds no `Assignment` — which is
also why the dead `Role` enum stays dead.

**Several people may share one company.** A CSR decision is a company's, but
the people doing it are individuals with their own logins, and an individual
may change employers.

**The gap that motivated this is now a requirement, not a footnote.** The
inquiry enters the Admin queue and today the company hears nothing: the
notification goes to `partnershipTeamRecipient()`, the platform team, with the
company's address in plain text and no `replyTo`. An account is what makes
"what happened to my inquiry" answerable, so the account and the missing
acknowledgement are the same piece of work.

## What this does not decide

- **What the account is anchored to.** The question asked "per-person or
  per-company" and the answer given is "several people may share one company",
  which settles that a *team* is a thing — but not whether the account belongs
  to the person with a membership in a company, or to the company with several
  people on it. Those give different data models and different questions
  ("my company's inquiries" versus "inquiries I sent"), and the second cannot
  be answered at all without the company existing as a record.
- **Whether a company is verified.** A `Partner Organisation` is verified by a
  Verifier against legal documents. A company sending an inquiry is not a
  `Partner Organisation` and is not being funded, so a lighter touch is
  probably right — but "probably right" is not a rule, and nobody has written
  one.
- **What a Tim CSR can do after registering.** Browsing Programs is public
  today. An account that adds nothing but an inquiry list may not be worth
  building; one that also surfaces a per-Sector shortlist is a different piece
  of work. Nobody has said which.
- **How long their contact data is kept.** The same question FFI-16 raises for
  Donors applies here, and it has not been asked.
