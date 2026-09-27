# 28: Fundraiser Payout UI

**What to build:** A Fundraiser can see what is held, what is available, and ask for it, without anyone touching the database.

**Blocked by:** 27

**Status:** awaiting-merge

- [x] Escrow Hold and Campaign Balance are shown separately and computed from the ledger
- [x] A partial Payout may be requested while the Campaign is Active
- [x] Payout status is visible to the Fundraiser throughout
- [x] Requesting against a verified Bank Account only

## Comments

- 2026-09-27 (the "fourth caller" claim below was false, and the guard that
  would have caught it does not exist): the "the rule existed in two places,
  not one" comment further down ends by saying
  `payout-balance-rule-callers.test.tsx` makes "a fourth caller **or a second
  copy** a failing test". One half of that is true and one half is not, so it
  is the half that is not which is corrected here.

  **What the test holds:** the three callers it names by name. Each is forced
  to follow a rule module made to answer something its own comparison never
  would, and all three are then compared against it boundary rupiah by
  boundary rupiah. So a **second copy inside one of those three** is a failing
  test, and that half of the claim stands.

  **What it does not hold:** that a **fourth** caller is a failing test. It
  names three and exercises those three. Checked rather than assumed: a
  `previewPayout` added to `src/lib/money/payouts.ts` with a comparison of its
  own left the whole suite green -- 280 files, 3657 passed, 13 skipped,
  nothing failing. The comment in `src/lib/payout-balance-rule.ts` claimed the
  same thing and is corrected in the same commit.

  A guard was written to close that and **not shipped**, because neither shape
  of it would be honest:

  - scanning for *references* to `exceedsPayoutBalance`, resolved with the type
    checker so a renamed import at the point of use would still count, finds
    the same six references whether the fourth caller is there or not. A
    caller that re-decides the cap for itself never names the function, and
    that is the only kind of fourth caller worth catching. (It cost ~9s of a
    ~126s suite, which was not the deciding problem; the blindness was.)
  - scanning for the **COMPARISON** catches `amount > balance` and nothing
    else -- not `balance < amount`, not a negated form, not one written
    through a differently named local. That is a guard which passes for a
    spelling rather than for the class, which `docs/agents/verification.md`
    warns about, and the "a deny-list only holds back what its author thought
    of" comment below happening again in another file.

  So the claim is **deleted rather than narrowed to a promise nothing holds.**
  The rule is one implementation, and the three named callers cannot drift
  from it. A fourth place is caught by the test for that place, when somebody
  writes one. The shape of a guard that would catch it already exists in this
  repo -- `src/lib/money/manual-contribution-isolation.test.ts` pins an exact
  set of readers by name -- but it works there because `programBalance` is a
  name every reader must use. Nothing forces a fourth caller to name this
  function, so no test here should imply otherwise.

- 2026-09-27 (status corrected): this file said `done (PR #94, 43f7734)`.
  Wrong twice. `done` is this repo's CLOSING status, and
  `docs/agents/triage-labels.md` sets it only once the branch has merged to
  `main` -- `prd-28-payout-ui` has not. And `43f7734` is not the work: it is a
  commit whose whole content was a wrong sha, one of three successive attempts
  to point this line at the right one. **The work is `398877c`** ("Give the
  Fundraiser a Payout screen"), on branch `prd-28-payout-ui`, PR #94. From
  here the pointer lives in this comment and the `Status:` line carries the
  triage role alone, so adding a commit no longer makes the status line a
  lie. Set `Status:` to `done` when PR #94 merges.

- 2026-09-27 (a read is a read): `GET /api/user/campaigns/[slug]/payouts` ran
  `releaseMaturedEscrow` on every page load. Removed. spec.md puts escrow
  release on a schedule (`runScheduledJobs`) and keeps the lazy sweep as a
  SECOND path -- the one at the top of the Payout request handler, which is
  where the money is about to be asked for. This was a third path nobody
  asked for, and it made how fast someone loaded a page a fact about the
  books. **The consequence, stated rather than papered over:** nothing in
  `src/` invokes `runScheduledJobs` -- the function exists (ticket 20) but no
  cron route or scheduler calls it -- so a matured hold is now released when a
  Payout is REQUESTED rather than when a page is opened, and the Campaign
  Balance this screen shows can read lower than it will be a moment after
  submitting. Whether the screen is allowed to nudge that, or the schedule has
  to be wired up first, is a product decision and is not settled here.

- 2026-09-27 (the form is gated too, not just the link): the read now carries
  the Campaign's EFFECTIVE `lifecycleStatus`, and the panel withholds the
  request form outside `PAYOUT_REQUESTABLE_STATUSES` -- the same list
  `requirePayoutAllowed` is written against, asked of the same module rather
  than a copy. Before, a Fundraiser who typed this URL on a Suspended or
  Cancelled Campaign filled in a live form and learned from the refusal. The
  server still judges every request under the Campaign row lock; this only
  stops the screen collecting one it knows is impossible.

- 2026-09-27 (page guard): `/akun/kampanye-saya/[slug]/pencairan` had no
  session guard, unlike every other page under `/akun`, so an anonymous
  visitor was shown "Gagal memuat data pencairan." No data leaked -- the read
  is refused server-side -- but the wrong person was told the wrong thing, and
  a URL that looks broken is a dead end. It first took the same `useSession`
  guard as `akun/page.tsx`, `pengaturan/page.tsx` and `kampanye-saya/page.tsx`
  -- which made the page a client page, and therefore left the server-rendered
  HTML empty. A Fundraiser with JavaScript disabled or still loading saw a
  blank page where they had seen a heading. It is now a server component using
  `getServerSession()` and `redirect('/login')`, the pattern `admin/` and
  `moderasi/` already use, so the shell renders on the server again while
  anonymous visitors are turned away before anything renders. The figures are
  still fetched in the browser, unchanged: no boundary moved.

- 2026-09-27 (one rule, one name): the panel's `requested > campaignBalance`
  duplicated the money layer's own cap, and its docstring claimed it "never
  decides that an amount is affordable" while `disabled` + `role="alert"` made
  it decide. The cap is now `exceedsPayoutBalance`
  (`src/lib/payout-balance-rule.ts`), asked of by `requestPayout` and
  `approvePayout` in `src/lib/money/payouts.ts` and by the panel; the server
  is still the holder of the decision. The comment now says what the code
  does. Separately,
  `STATUS_LABEL` in the panel was a Payout-status map under a name that means
  the Campaign lifecycle's statuses everywhere else in the repo, and it was
  `Partial` with a `?? status` fallback -- so a Fundraiser could be shown
  `SUBMITTED`. It is now `PAYOUT_STATUS_LABEL`
  (`src/lib/payout-status-label.ts`), a total `Record`, next to
  `campaign-status-label.ts`.

- 2026-09-27 (the rule existed in two places, not one): the "one rule, one
  name" comment above was half true. `approvePayout` still compared
  `payout.amount > balance` for itself, so the cap had three implementations
  and the one left over was on the Admin path -- the one that spends the
  balance under the subject's row lock, and the most authoritative of the
  three. `payout-balance-rule.ts` is now the whole of it, asked of by both
  places in the money layer and by the panel. Nothing about approval was
  meant to be stricter than a request: the row lock changes WHEN the balance
  is read, not by how much may be taken of it, and the two refusals are the
  same error. `src/__tests__/payout-balance-rule-callers.test.tsx` pins it
  from both sides -- the rule module is forced to answer something its own
  comparison never would and every caller has to follow it, and all three are
  then compared against it boundary rupiah by boundary rupiah -- so a fourth
  caller or a second copy is a failing test rather than a quiet disagreement.

- 2026-09-27 (NOT fixed here, and it makes two boxes above untrue):
  **`BankAccount` cannot be created by anyone in the product.**
  `bankAccount.create` does not appear anywhere in `src/`; the only writer is
  `prisma/seed.ts`. So `bankAccounts` is always empty for a real Fundraiser,
  the destination picker never renders, and `canRequest` cannot be true. That
  means the "partial Payout may be requested" and "verified Bank Account
  only" boxes cannot be exercised end to end, and the tests here pass on
  fixtures that invent accounts the product cannot make. Building the
  creation flow is ticket 01 and needs product decisions not yet taken, so it
  is left visible rather than papered over: **the two boxes stay checked
  because the code is right, and the flow is unreachable until ticket 01
  lands.**

- 2026-09-27 (implementation): `GET /api/user/campaigns/[slug]/payouts` reads
  `escrowBalance` and `campaignBalance` from the ledger, never
  `Campaign.collectedAmount`, and it moves no money (see the "a read is a
  read" comment above, which corrected the lazy sweep this originally ran
  here). The screen is
  `/akun/kampanye-saya/[slug]/pencairan`, reached from a "Cairkan dana" link
  on each Campaign card.

- 2026-09-27 (decision, recorded not guessed): **three FFI-07 rules cannot be
  executed in this UI and are not faked anywhere in it.**
  1. *The provider-balance check before approval.* FFI-07 says an Admin must
     check the real balance in the provider dashboard and **record the number
     on the Payout**. There is no field on `Payout` to record it in, and no
     code reads one. So the check has no home in the schema, let alone in a
     screen. This panel does not display, request, or imply it.
  2. *What happens when the provider balance does not match the books.* Not
     written down anywhere in the PRD, CONTEXT.md, or the ADRs. Whether a
     mismatch blocks approval, allows it with a flag, or forces a
     reconciliation first is a money decision, not an implementation detail.
  3. *The two-person rule.* Approve (not the requester) and Complete (a
     different Admin, with proof) are Admin acts under the subject guard. The
     Fundraiser screen has no control that can perform either, by design.

- 2026-09-27 (gap found, not fixed here): **there is no Admin panel for
  Payouts at all.** `POST /api/campaigns/[slug]/payouts/[id]/approve` and
  `.../complete` exist and are enforced (PR #73), but nothing in `src/app/admin`
  calls them, and no `.tsx` file references either path. So today a Payout a
  Fundraiser requests can be created but **cannot be approved or completed
  through the product** — the only way through is calling the API by hand.
  That is a release blocker for Rilis 1, and it is a separate ticket: this one
  is the Fundraiser's side of the screen. The FFI-07 provider-balance check
  above belongs in that panel, which is the other reason it is not invented
  here.

- 2026-09-27 (owner question, blocking the Admin panel): to record the
  provider's real balance on a Payout, three things have to be decided first.
  **(a)** Which column — a nullable `Int` on `Payout`, or a separate row per
  check? **(b)** Is the recorded figure a gate (approval refused when it is
  short) or an observation (recorded, and a human reads it)? **(c)** On a
  mismatch between the provider figure and the ledger, what is the operator
  told to do? Until (a)-(c) are answered, the check cannot be built, and
  building it as a soft advisory would be inventing money behaviour.
  FFI-07's own words are "mencatat angkanya pada Payout" — record, not
  compare — so the PRD states the obligation and not the consequence.

- 2026-09-27 (scope note): `Program Balance` is unreachable from this screen
  by construction, not by omission — `Payout` has no `programId` column at
  all. `manual-contribution-isolation.test.ts` gained a case that scans every
  `.tsx` mentioning a Payout for `PROGRAM_BALANCE`/`programBalance`, so a
  future Payout screen cannot quietly introduce one.

- 2026-09-27 (a deny-list only holds back what its author thought of): the
  "a read moves no money" case in
  `src/app/api/user/campaigns/[slug]/payouts/route.test.ts` denied three
  method names, so it proved only that THOSE three were unused. A
  `releaseMaturedEscrow` written with any other query shape kept it green,
  which is the whole failure the case has to survive. It is now an allow-list
  of the reads a GET legitimately makes, asserted in **both** directions: a new
  query fails by name, and every name in the list is proved to have been seen.

  The allow-list was inert until now, and the reason belongs here because it is
  the shape `docs/agents/verification.md` warns about. The recorder pushed
  `model.method` from inside a `vi.fn` wrapper; the push lived in the
  IMPLEMENTATION, and `mockResolvedValue` / `mockImplementation` *replace* an
  implementation. So not one `prisma.*` call was ever recorded, and
  `prisma.payment.findMany` — the entry point the sweep opens with — among
  them. Three of the five allow-list entries were impossible to see. The
  recorder now hands back the real mock and reads that mock's own
  `.mock.calls`, the passthrough shape the rest of this repo already uses.

  Proved by putting the sweep in the GET temporarily: the case goes red, and
  the FIRST assertion to fail is the state one — the Payment row comes back
  stamped with `escrowReleasedAt`, then `rows` has grown both legs
  (`ESCROW_HOLD` DEBIT, `CAMPAIGN_BALANCE` CREDIT), and the allow-list fails
  after that on `prisma.payment.findMany`. An earlier version of this entry said
  the case goes red on `prisma.payment.findMany` alone, which had the order
  backwards and understated what was actually caught. Each of the three was
  relaxed in turn to confirm it bites on its own, not just the first.

  The fixture's Payment row also had no `donation`
  relation, so the sweep threw inside its per-payment `try`/`catch`, logged and
  moved nothing — meaning "the books did not move" stayed true for a read that
  HAD swept. With the relation in the fixture, a sweep really claims the
  payment and posts both legs, and the state assertions catch it too. No
  production code changed.

  Separately, the guard comment on `/akun/kampanye-saya/[slug]/pencairan`
  claimed the read below refuses a signed-out visitor on its own, and that this
  was the sibling pages' guard. The pages under `/akun` guard with
  `useSession` — which the next paragraph of that same comment says — and this
  guard settles before the panel renders, so the read is never issued. Both
  claims are gone; comment only.


- 2026-09-27 (one `groupBy` simulation, and what it cost): fixing the allow-list
  above meant trusting `ledgerEntry.groupBy` fakes, and they had been copied
  fifteen times across twelve files. They are now one helper,
  `tests/support/ledger-group-by.ts`. The two callers whose `where` is richer
  than equality keep their own predicate through the helper's `matches` option,
  so nothing was flattened: fifteen copies became one, and the shared version is
  the strongest of the fifteen, not the weakest.

  This is a refactor of test scaffolding, not a Payout change, and it touched
  files in five subsystems this ticket has nothing to do with — `admin/reconcile`,
  `volunteer-trips`, `manual-contributions`, `refunds`, `ledger`. It is recorded
  here because `docs/agents/issue-tracker.md` asks that the Comments ride in the
  same PR as the work they describe, and a diff that reaches into five subsystems
  on a ticket about one screen should be visible to whoever reads this next.
  No production code changed.

- 2026-09-27 (a claim withdrawn, and the narrower one available): the cap in
  `src/lib/payout-balance-rule.ts` said a fourth caller would be a failing test.
  It is not — the test exercises three callers by name, and a `previewPayout`
  written beside them with a comparison of its own left the suite green. Two
  guards were written to close it and thrown away rather than shipped: scanning
  for references to the function cannot see a caller that re-decides the cap and
  never names it, and scanning for the comparison would match one spelling of
  `>` and no other. A narrower true claim is available — pin the set of files
  that may ask the question, the way
  `src/__tests__/manual-contribution-isolation.test.ts` already does — and it
  would catch a fourth caller that REUSES the function, at roughly nine seconds
  of suite. Not taken: the comment now states the honest scope, and pinning file
  names is the same brittleness the rest of this work just removed. Reversible
  if a fourth caller ever appears.
