# 16: A person creates a Bank Account, and a Verifier is what verifies it

**Type:** implementation

**Status:** open

**Blocked by:** nothing — 01 is `resolved` and this ticket is the code for it

## Why this is the blocker — and the second thing that is also blocking it

`bankAccount.create` does not exist in `src/`; the only writer is
`prisma/seed.ts:446`. `src/lib/money/payouts.ts:157` and `:362` refuse a
destination without a `verifiedAt`, so no Payout can be pointed at a real
account and PR #109's screen stays unreachable.

**That is one blocker of two, and the other is not this ticket's work.** The
earlier version of this section said nothing else unblocks first. It was wrong,
and the correction is recorded in full under *The Payout screen has two
blockers, not one* below. Read that section before estimating what this ticket
unblocks.

## Decisions this implements

Six owner decisions, 2026-09-28, on top of
[ADR 0018](../../docs/adr/0018-bank-account-born-unverified-verified-by-request.md)
and `CONTEXT.md`'s Bank Account entry. Those two are the boundary; none of
these six reopens them. Decisions 5 and 6 were taken later the same day, after
this ticket was first written down, and they answer what were then the open
questions 1 and 2 below.

1. **The name read off the document is a column on the verification record,
   not on `BankAccount`.** `BankAccount.accountName` stays the owner's own
   claim and stays plaintext (ADR 0012 compares it with the Donation name).
   Putting the document's name on `BankAccount` would let the second check
   overwrite the evidence of the first.
2. **"Rekening sesuai" is not a checklist item.** `VerificationChecklistItem.kind`
   is `Kind?` — DONATION/ZAKAT/WAKAF/HIBAH — and a new enum value would make
   the checklist stop being a template of campaign documents. The check is two
   fields on the Verifier's form instead.
3. **The Refund account is a separate ticket**, not here. Consequence to carry
   honestly: ADR 0012's stated reason for keeping `accountName` in plaintext is
   that Refund compares the holder's name with the Donation's name. Until that
   ticket ships, that reason is a **claim with nothing behind it** — the column
   is plaintext and the comparison that justifies it does not exist. Do not
   cite ADR 0012 as a defence of the plaintext column in a code review before
   that ticket lands.
4. **A new table, not `VerificationRequest` with a nullable `campaignId`.**
   `VerificationRequest.campaignId` is required and its relation is
   `onDelete: Restrict`; a bank account belongs to a `User`, who has no
   Campaign, so the column would have to go nullable and the table would stop
   being "one submission of a Campaign". **This reverses ADR 0018's stated
   reason, not its decision.** ADR 0018 refused a separate bank-account page
   because "a Bank Account belongs to a subject that already has a queue" — a
   User is not a subject, and no User has a queue. The decision (piggyback on
   the Verifier's existing two-person rule, reuse the `SUBMITTED`/`PENDING`
   queue discipline) stands; the fourth queue is the honest price.
5. **An unverified account that has never had a request may be deleted; an
   account may not be edited, ever.** The refusal is not "editing money is
   risky". It is that the number *is* what a Payout points at: a Payout holds
   `Payout.bankAccountId` (`prisma/schema.prisma:1684`, required), and an edit
   after a Payout exists would silently repoint money already instructed. That
   edit is **aimsia** — the transfer cannot be un-sent and the row no longer
   describes where the money went. A wrong number is fixed by deleting and
   re-adding, which is exactly why delete has to exist; it is not fixed by
   editing. "Never had a request" is the whole condition: a single row in
   `BankAccountVerificationRequest`, of any outcome, makes the row a record of
   a statement a Verifier looked at, and records are not deleted.
   **The cost of this decision, stated plainly:** an account that was
   submitted, was **REJECTED**, and turns out to have been typed wrong is stuck
   **permanently** — delete is refused (a request exists) and edit is refused
   (always). Its owner can add a different account, but the wrong one stays in
   their list forever, and `payouts.ts` will refuse it forever. The owner has
   accepted this. Do not "helpfully" relax either half in a code review, and do
   not quietly re-open it: if it is wrong, it is a new decision, in writing.
6. **The Verifier sees the full number in the decide panel, and a masked one in
   the queue list.** The reason, which belongs in a comment on the decrypt call
   so the next reader does not "fix" it back to a mask: **a name can be checked
   without the number, and a mistyped digit cannot.** A Verifier who cannot see
   the digits is not looking at the part most likely to be wrong, so a check they
   cannot fail is not a check. Masking the decide panel would make the whole
   verification theatre. The consequence to carry: **the number must be
   decrypted on the Verifier path, not only at payout.** Ticket 12 asked where
   that read is allowed; this is the second one, and it is a decision now, not
   an open question. What it costs is written under *The Verifier's read* below
   — do not present it as free.

## Schema — exact

New model, in `prisma/schema.prisma`:

- `BankAccountVerificationRequest`
  - `id String @id @default(cuid())`
  - `bankAccountId String` → `BankAccount`, `onDelete: Cascade`
  - `outcome VerificationOutcome @default(PENDING)` — **reuse the existing
    enum**, do not add one: `VerificationOutcome` already holds PENDING /
    APPROVED / REJECTED / WITHDRAWN, and withdrawal is wanted (below).
  - `checkedBankCode String?` and `documentedAccountName String?` — what the
    Verifier read off the document. **Both required to APPROVE**; both null on
    a rejection. These are decision 1 and decision 2 together.
  - `note String?` — the free note of what was looked at. Never required.
  - `submittedById String` → `User` ("BankAccountVerificationSubmitter"),
    `onDelete: Restrict`
  - `submittedAt DateTime @default(now())`
  - `decidedById String?` → `User` ("BankAccountVerificationDecider"),
    `onDelete: Restrict`; `decidedAt DateTime?`
  - `@@index([outcome, submittedAt])` and `@@index([bankAccountId, submittedAt])`
    — the first is the Verifier queue, the second is one account's history.

Changed, no new columns on `BankAccount`:

- `BankAccount.verificationRequests BankAccountVerificationRequest[]`
- `User.bankAccountVerificationsSubmitted` / `...Decided` on the two new
  relations.

Unchanged on purpose: `BankAccount.bankCode`, `accountName`,
`accountNumberCiphertext`, `accountNumberKeyId`, `verifiedAt`. `verifiedAt` is
still the single field the money path reads (`payouts.ts:158`, `:362`), and it
is still the only thing that makes a destination eligible.

`VerificationChecklistItem` and `VerificationRequest` are **untouched**: no
checklist row, no new Kind, no nullable `campaignId`. There is no backfill of
the new table. The seed's accounts carry a `verifiedAt` and no check record;
that is honest, because no real account exists yet and a fabricated verifier id
and date would be a lie. Nothing breaks: no read path needs the record.

One migration, `prisma/migrations/<timestamp>_bank_account_verification_request/`.

## Flow

1. **The owner adds the account**, signed in, on their own page
   (`/akun/rekening`). `POST /api/bank-accounts` with `bankCode`, `accountName`,
   `accountNumber`. The number goes through
   `sealBankAccountNumber` (`src/lib/contact-fields.ts:185`) and is never
   logged or returned in plaintext. `verifiedAt` is **not** a request field —
   there is nothing to pass and nothing to let through.
   Any signed-in user may do this. `Assignment` holds only VERIFIER and ADMIN
   (no FUNDRAISER — `FUNDRAISER` at `prisma/schema.prisma:503` is
   `StatusChangeCapacity`, an audit value), so the rule is ownership, not an
   assignment, and it matches how `POST /api/campaigns` already authorises.
   `bankCode` is free text, as it is in the seed: there is no bank list in
   `src/`, and inventing one is not this ticket's work. It is therefore the
   Verifier's `checkedBankCode` that makes the field checkable — if what the
   document says is not what the owner typed, the two columns differ and the
   check is visible.
2. **The owner submits the account for checking.** One PENDING request per
   account: submitting an account that already has a PENDING request is
   refused, and so is submitting one that already has a `verifiedAt`
   (decision 1's "checked once"). A REJECTED or WITHDRAWN account may be
   submitted again, which is a new row and keeps the old decision — the same
   history rule `CONTEXT.md` gives a resubmitted Campaign. The owner may
   withdraw their own PENDING request.
2b. **The owner may delete an account, and may never edit one** (decision 5).
   The button is shown only for an account with no `verifiedAt` and **no
   request row of any outcome** — not "no PENDING request". The service layer
   refuses regardless of what the button did: a hidden button is not the rule.
   No edit control is rendered at all.
3. **A Verifier sees the queue.** `GET /api/moderasi/bank-accounts`, wrapped in
   `withAssignmentCheck(Assignment.VERIFIER, ...)`, returning PENDING requests
   with the account's `bankCode`, `accountName` and **masked** number.
4. **The Verifier decides.** `POST /api/moderasi/bank-accounts/[requestId]` with
   `decision`, `checkedBankCode`, `documentedAccountName`, `note`, and `reason`
   when rejecting. Approval requires both checked fields; a rejection requires a
   reason. Approval writes `verifiedAt` — see the rules below.

## Rules the write path must enforce, not the UI (ADR 0018)

- **`verifiedAt` is written once.** Write it as
  `updateMany({ where: { id, verifiedAt: null }, data: { verifiedAt: now } })`
  and throw when `count === 0` — the same conditional-write guard
  `closeRequest` (`src/lib/campaign-lifecycle.ts:729`) already uses for a
  request that is no longer PENDING. **Do not add a `FOR UPDATE` on
  `BankAccount`** and do not put a Bank Account in `LedgerSubject` or
  `subject-guard.ts`: a bank account is not a ledger subject, and the
  property test `src/__tests__/properties/subject-lock-single-owner.test.ts`
  only pins locks on Campaign, VolunteerTrip, Batch and Registration, so a
  new lock there would be unowned.
- **A Verifier may not decide their own account.** `verifierId !==
  bankAccount.ownerId`, refused in the command. Same shape as
  `requireNotOwnerAsAdmin` but with `StatusChangeCapacity.VERIFIER`; extend
  `capacity.ts`'s `judgeCapacity` only if that stays a one-line change, and put
  the refusal in the command either way, as ADR 0018 requires.
- **Approval is the only writer of `verifiedAt`.** Not the submit path, not an
  Admin route, not the seed.
- **No uniqueness promise, and none is invented.** Two accounts with the same
  number stay possible: the number is a randomized ciphertext with no HMAC
  (ADR 0012), so nothing can compare them. The compensation is the one ADR 0018
  names — the account a Payout points at is the account verified before the
  Payout is approved, checked in `payouts.ts` and unchanged by this ticket. A
  comment on the model must say so, so no one later reads the absence of a
  constraint as an oversight.
- **Notification**: in-app `notify` on submit and on decision. **No email.**
  `decideVerificationRequest` emails through a campaign template that embeds
  `/campaign/[slug]`; there is no bank-account template and inventing one is
  not this ticket. Say so in the route rather than leaving it looking
  forgotten.
- **Delete and edit live in the service layer, not the button.** Decision 5 is a
  rule about the row, and a rule about the row that lives in a React component
  is not a rule: a second caller, a script, or a future "quick fix" route would
  walk straight past it. Put both refusals in
  `src/lib/bank-account-verification.ts` next to the other commands, and have
  the routes do nothing but parse and map errors.
  - **Delete** (`DELETE /api/bank-accounts/[id]`): refused unless
    `verifiedAt IS NULL` **and** `verificationRequests` has no row at all.
    Both halves are checked in the command, in one read, and the request count
    is not filtered by `outcome` — `REJECTED` and `WITHDRAWN` block the delete
    just as `PENDING` does. Refusing on a count rather than on
    "no non-REJECTED rows" is the point of the rule; do not optimise it away.
  - **Edit**: **there is no edit path at all.** Not a hidden one, not an
    Admin-only one. `bankAccount.update` is not reachable from any route. If
    the owner's own page renders a pencil icon, that is a bug. The cleanest
    honest shape is that `PATCH`/`PUT` on the route is not implemented and a
    test asserts it — an unimplemented method is a stronger statement than a
    guard that could be relaxed.
  - Ownership: both are the owner's own account only (`bankAccount.ownerId ===
    session.user.id`), like the rest of `/api/bank-accounts`. A Verifier
    reaching someone's account must not be able to delete it either.

  **The three tests that must exist** — this is decision 5's proof, and a
  builder who writes the rules without them has shipped a UI, not a rule:

  1. delete **succeeds** when `verifiedAt IS NULL` and there is no request row;
  2. delete is **refused** when a request row exists, and the test covers a
     `REJECTED` row as well as a `PENDING` one — a test that only covers
     `PENDING` does not prove this decision;
  3. edit is **refused** — the route answers 405 / the command throws, and the
     account's `bankCode`/`accountName`/number are unchanged afterwards.

## The fourth card on `/moderasi` — unavoidable

`src/app/moderasi/page.tsx` is a hand-written `grid` of three cards, and its
count is a `prisma.verificationRequest.count`, which this new table does not
join. So the page needs a fourth card, a fourth `count` against
`bankAccountVerificationRequest where outcome: PENDING`, and a link to a queue
page. Add the same `NavLink` to `src/app/moderasi/layout.tsx`, which is a
hand-written nav list of five entries.

- `/moderasi` card: label "Rekening Menunggu Verifikasi", the PENDING count, a
  link to `/moderasi/rekening`. Same markup as the campaign card, including
  its `page.test.tsx` sibling.
- `/moderasi/rekening`: the queue, oldest first. Each row: owner's name, the
  bank's code, the name on the account, a **masked** number (`1234****5678`,
  showing only the tail), and the account's own status — `verifiedAt` is
  already set, or the request's `submittedAt`.
- The decide panel is the two fields from decision 2, labelled as what was read
  off the document, plus the free note, plus reject-with-reason. The panel
  must **not** render a checklist, because there is none for this subject.
- **The decide panel shows the full number (decision 6), decrypted server-side
  through `readBankAccountNumber` and `SELECT_BANK_ACCOUNT_NUMBER`.** The list
  shows it masked. The mask needs a helper that **does not exist yet** — see
  *The Verifier's read* below; do not assume `src/` has one.

## The Verifier's read — can it be done with the code as it stands?

Checked on `origin/main` at `a1889fe`, because decision 6 assumes it and the
assumption had never been tested. **Mostly yes, with one thing missing.**

**It can.** The decrypt already exists and is exported:
`readBankAccountNumber` at `src/lib/contact-fields.ts:188`, with
`SELECT_BANK_ACCOUNT_NUMBER` at `src/lib/contact-fields.ts:191` for the
`select`. It has no production caller today (only
`src/lib/contact-fields.test.ts:109` and `src/lib/field-protection.test.ts:76`),
so nothing is being extended — it is being used. The keys come from
`requireFieldKeys()` (`src/lib/contact-fields.ts:145`, reading
`FIELD_ENCRYPTION_KEY` and friends per `src/lib/field-encryption.ts:23`), which
is an environment question, not a code obstacle.

**Nothing registers a reader.** `src/lib/field-protection.ts` is a **write**
extension only — `contactFieldWrites()` at
`src/lib/field-protection.ts:82` seals `data` on create/update and never
touches a read. `src/lib/contact-plaintext-readers.test.ts` guards the
**dropped plaintext columns** from coming back, not the ciphertexts from being
read. So there is no allowlist to be added to and no test that will fail when
this ticket decrypts on a second path. Good news, and the reason it has to be
said here: a reader is also unrecorded, which is the next point.

**And the path can reach it.** `/moderasi` is server-rendered and talks to
Prisma directly: `src/app/moderasi/page.tsx:10` is `async` and its
`prisma.verificationRequest.count` at `:18` proves the page is a server
component with database access, and `src/app/moderasi/layout.tsx:14` gates the
whole tree on `hasAssignment(..., Assignment.VERIFIER)`. A server component may
call `readBankAccountNumber`; no client boundary blocks it.

**What is missing, and is this ticket's work: the mask.** `grep -ril mask src/`
returns exactly one file, `src/__tests__/deploy-gate.test.ts`, which is about
something else entirely. **There is no masking helper in `src/`.** Ticket 12
noticed this ("'Masking at the UI' is asserted but no mask is implemented
either") and left it as a question; decision 6 makes it a dependency. The
masked list and the full decide panel are the two halves of one decision, so
one small exported helper — tail-only, fixed width, never revealing a middle
digit — is in scope, with a test that it cannot emit a short number in full.
This is a small addition to the file list, not a surprise.

**What decision 6 costs, in the ticket's own words rather than softened.** ADR
0012 already concedes the general shape of this: it "does not stop an Admin with
panel access from reading a Donor's details; that needs an access log on the
panel, which does not exist today" (`docs/adr/0012*.md:19`). The Verifier's
read is exactly that, one field wider, and it is **not logged anywhere** — ADR
0012 chose a randomized ciphertext with no HMAC, so there is no search trail
even in principle. Two honest consequences to state in the command's comment
rather than leave for a reviewer to notice:

- the plaintext now reaches a rendered page. If the decide panel is a **client**
  component, the number crosses the wire as a prop or in the RSC payload and
  sits in view-source. Render it in the server component, or accept that
  consciously;
- the count of unmemoable reads goes from one (payout) to two (payout,
  verification). A builder must not present this as a rounding error on
  ADR 0012's cost.

**Not verified here:** whether the owner wants the read written to an audit log
as part of this ticket. Nobody has asked. It is not assumed either way, and the
absence is stated rather than quietly treated as settled.

## The Payout screen has two blockers, not one

The earlier version of this ticket said "Nothing else unblocks first", and the
map said PR #109's Payout screen was held up only by the absence of
`bankAccount.create`. **Both claims are incomplete.** Verified per-byte on
`origin/main` at `a1889fe`:

- **`Payout.bankAccountId` is already required** —
  `prisma/schema.prisma:1684`, `bankAccountId String` with no `?`, next to
  `bankAccount BankAccount @relation(...)` at `:1685`. (The line number quoted
  elsewhere for this is 1624; that is a different commit — the coordinator's
  local `fe1983d`, which has not diverged from `origin/main`. The *fact* holds
  on both, only the line number does not travel.)
- **The payout API already demands it** —
  `src/app/api/campaigns/[slug]/payouts/route.ts:10`,
  `bankAccountId: z.string().min(1, 'Rekening bank harus dipilih')`. The trip
  route is the same at `src/app/api/volunteer-trips/[slug]/payouts/route.ts:11`.

So the schema and the API have been asking for a bank account picker for a
while. What is missing is the **screen**:

- **No `.tsx` in `src/` names `bankAccount` at all** —
  `grep -ril bankaccount --include="*.tsx" src/` returns **0 files**. (For
  honesty: `grep -ril rekening --include="*.tsx" src/` returns two —
  `src/app/(static)/terms/page.tsx` and
  `src/app/(static)/faq/faq-accordion.tsx` — both static legal/marketing copy
  with no field and no form. Neither is the picker.)
- `Campaign` has **no** `bankAccountId` either; the only one in the schema is
  `Payout.bankAccountId`.

**Consequence: #114 has two blockers, and this ticket closes one of them.**
Building the account, the queue and the fourth card gives a Verifier something
to verify, and gives a Payout a verified destination to point at. It does not
give anyone a way to *choose* that destination: the picker in the Payout form
is separate work, on a form this ticket does not touch, and the owner has said
so. Ticket 16 must not be reported as "unblocks the Payout screen" on its own.


## Size, honestly

**About 15 production files, 1 migration, 8 test files** — up from 13/1/7 once
decision 5's delete route and decision 6's mask helper are in. Larger than
every other ticket on this map, and the diff will be far past the ~300 lines
that triggers parallel Standards and Spec review. If the owner wants it smaller,
the clean split is *16a* (schema, the command, the owner's page and its three
routes, tests) then *16b* (the Verifier queue, the decide route, the fourth
card, tests), with 16b blocked by 16a. Splitting does not unblock the Payout
any sooner, because a verified account needs both halves — and neither half
touches the missing picker, which is why "ship 16, the Payout screen works" is
not a sentence anyone should say on the strength of this ticket.

Approximate list: `prisma/schema.prisma`; the migration;
`src/lib/bank-account-verification.ts` and its co-located tests (a
`src/lib/bank-account-verification-errors.ts` or additions to
`domain-errors.ts`'s code union, following
`campaign-lifecycle-errors.ts`); a small masking helper (decision 6 — new, see
above) and its test; `src/app/api/bank-accounts/route.ts` (+test);
`src/app/api/bank-accounts/[id]/route.ts` for **DELETE only** (+test, covering
all three cases decision 5 requires); `src/app/api/bank-accounts/[id]/verification-requests/route.ts`
(+test); `src/app/api/moderasi/bank-accounts/route.ts` (+test);
`src/app/api/moderasi/bank-accounts/[requestId]/route.ts` (+test);
`src/app/akun/rekening/page.tsx` + `BankAccountRegister.tsx` (+test, mirroring
`PartnerOrganisationRegister.tsx`); `src/app/moderasi/rekening/page.tsx` +
panel (+test); `src/app/moderasi/page.tsx` (+`page.test.tsx`);
`src/app/moderasi/layout.tsx`. `prisma/seed.ts` needs no change.

## Notes

`CONTEXT.md`'s Verification Request entry says a change of a Campaign's Bank
Account needs a new Verification Request. That is not implementable against
today's schema, because a Campaign has no `bankAccountId`; it is recorded here
as a fact about the current code, not as a gap this ticket is silently leaving
for someone to discover.

Related: [01](01-bank-account-verification.md) (the decision),
[11](11-clearing-a-bank-account-verification.md) (clearing `verifiedAt` — still
open, and the read side already refuses a cleared account),
[12](12-decrypting-a-bank-account-at-payout.md) (where the number is read).

**Ticket 12 is partly answered and partly not.** Decision 6 answers its
question 4 — yes, the Verifier's check does need the number, and here is where
it is decrypted. Its questions 1, 2 and 3 are untouched by this ticket: what
instructs the transfer, who may read the number in general, and the mask. **The
ticket's own "not verified here" note is the honest place to look**: the read
now exists on two paths and neither is logged, and whether it should be is
nobody's decision yet.
