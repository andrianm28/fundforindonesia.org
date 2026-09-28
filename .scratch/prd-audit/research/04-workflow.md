# Research 04: Matt Pocock workflow compliance since 2026-09-26

Ticket: `.scratch/prd-audit/issues/04-matt-workflow-compliance.md`. Scope per
`.scratch/prd-audit/map.md`: artefacts and doc hygiene checked fully; process
sampled over the 10 most recent money-code PRs; everything measured only
since 2026-09-26 (Matt skills adoption). Read-only: `origin/main` git history,
GitHub PR data (`andrianm28/fundforindonesia.org`), and files under
`.scratch/**`. No tests run.

## Ranked findings

### 1. [HIGH] Zero independent review recorded on GitHub for any of the 10 most recent money-code PRs

**Evidence:** `mcp__github__pull_request_read(method: get_reviews)` returns an
empty array for every one of the 10 most recent PRs that touch
`src/lib/money/**`, `payouts`, `refunds`, `ledger`, or `escrow`:
PR #121 (bank account create/verify), #108 (collection-account reconcile,
the live replacement for closed PR #93), #102 (`completePayout` re-check),
#101 (refund-kind refusal), #100 (escrow sweep net-of-fees fix), #99
(scheduled-jobs trigger), #83 (fees-drain), #82 (ledger transaction-id
unique), #73 (payout completion), #44 (Sumopod donation e2e) — `get_comments`
is likewise empty on the ones checked (#121). CI itself is green on the ones
checked (#121, #108: 7/7 check-runs `success`), so this is specifically about
review, not CI.

AGENTS.md, "Review": *"Kode uang, keamanan, atau konkurensi selalu mendapat
review independen `sonnet`."* None of this is visible as a GitHub review
object; the only trace of any review is prose folded into the PR/commit body
itself, e.g. PR #100's body: *"The 12 near-miss reason cases a reviewer
counted are 11"* — a claim about a reviewer's work that only the author's own
retelling preserves. `docs/agents/verification.md` ("The same failure, in the
text an agent writes") already establishes that this repo does not trust
prose-only verification claims for exactly this reason (it names a materially
identical eleven/twelve near-miss claim as one of three false statements
found in commit messages on 2026-09-28).

**Fix:** new-rule. Require the independent reviewer's findings to be posted
as an actual PR review or issue comment (`pull_request_review_write` /
`add_issue_comment`), not only summarized into the author's own commit
message. This also gives `05`/`06` triage something durable to audit instead
of re-deriving from narrative.

### 2. [HIGH] A `done` ticket cites a PR that was never merged

**Evidence:** `.scratch/prd-compliance-fase-0-2/issues/35-collection-account-reconcile.md`
Status line: `done (PR #93, 9e3e6d6)`. `pull_request_read(#93)` returns
`"state":"closed","merged":false`. `git merge-base --is-ancestor 9e3e6d6
origin/main` → not an ancestor. The feature (`COLLECTION_ACCOUNT`,
`ProviderWithdrawal`) is on `main`, but it landed as commit `a1889fe` via the
re-opened PR #108 (`pr93-carried`), not PR #93/`9e3e6d6`. The ticket file was
never updated to the real PR/commit after the branch was recreated — this is
the exact "`done` tiket yang PR-nya belum merge" pattern ticket 04 asks to
check for, just with the wrong PR/sha rather than no PR at all. (Context: the
underlying cause is the "carry trap" this session's own handoff already
documents — `.scratch/rilis-1-benda/handoff-2026-09-28.md`, "Jebakan yang
harus Anda tahu": rebuilt branches silently dropping merged fixes — so the
mechanism is known, but this one ticket's citation was never corrected.)

**Fix:** fix-now. Update the Status line to `done (PR #108, a1889fe)`.

### 3. [MEDIUM] AGENTS.md and a handoff doc disagree on the background-agent cap (the literal "4 vs 8" the ticket names)

**Evidence:** `AGENTS.md` (commit `ef4a8a2`, 2026-09-28) replaced the flat
cap with: *"owner's replacement of the earlier limit of 4 (2026-09-27): 8 for
now, and the number is not a measurement. **What is measured is 4 vCPU.**"*
`.scratch/rilis-1-benda/handoff-map.md:176`, under "Standing rules from Dri"
(written 2026-09-27, not touched since — its own later "Addendum
2026-09-28" edits other sections but not this line), still reads: *"At most 4
background subagents (4 vCPU container — do not run a full suite on all four
at once)."* A fresh session that reads the handoff (which `docs/agents/cloud-environment.md`-style
onboarding tells it to read first) before `AGENTS.md`'s nuance would
under-parallelize read-only work, or over-trust a plain agent count instead of
watching CPU contention as AGENTS.md now says to.

**Fix:** new-rule/fix-now. Either add a one-line addendum to
`handoff-map.md` the same way it already does for its Prisma/ratchet claims
("A stale prisma client makes `tsc` lie..."), or — better — stop repeating the
cap in handoff docs at all and have them point to `AGENTS.md` as the single
source, since `AGENTS.md`'s own header already claims that role for the repo's
model-tiering rules.

### 4. [MEDIUM] `CONTEXT.md` is not glossary-only; it carries file paths and code identifiers

**Evidence:** `.claude/skills/domain-modeling/CONTEXT-FORMAT.md`: *"Keep
definitions tight... Define what it IS, not what it does."* `CLAUDE.md`
calls `CONTEXT.md` a glossary. But three entries embed implementation detail:
- Line 229 (Usage Report): `` `prisma/schema.prisma` ``, `` `src/lib/campaign-lifecycle.ts` ``,
  `` `src/app/api/admin/scrutiny/route.ts` ``.
- Line 240 (Dormant Balance): `` `src/lib/scheduled-jobs.ts` ``.
- Line 244 (Bank Account): `` `bankAccount.create` ``, `` `src/` ``.

These were added deliberately (commit `ef4a8a2`, "keep the glossary in the
present tense only where there is code for it") to stop the glossary
describing unbuilt features as real — a good goal, but it reaches it by
pasting exactly the kind of path/line detail that `docs/agents/verification.md`
warns goes stale fastest ("a claim about a tree... stops being true at the
next commit that touches the file"). If `bankAccount.create` is added
tomorrow, or `scheduled-jobs.ts` is split, these three glossary entries go
stale silently, which is worse for a glossary than the vagueness they replaced.

**Fix:** new-rule. Keep the "not built yet" caveat (that's a legitimate
domain fact worth having) but drop the specific paths/identifiers — say "no
code writes this yet" rather than naming the file, so the claim can't be
falsified by an unrelated refactor.

### 5. [LOW] At least one money-adjacent commit reached `main` with a shape GitHub does not report as a normal PR merge

**Evidence:** `a1889fe` (the real land of ticket 35, see #2 above) and
`7760ff8` ("rilis-1: the picker is already in #114...") are single-parent
commits on `origin/main` with no matching "Merge pull request #N" message,
while their associated PRs (#93→#108 for the former) show `merged: false` in
the GitHub API despite a `merged_at` timestamp — an inconsistency consistent
with a rebase/fast-forward push rather than the GitHub merge button. Branch
protection is still unconfigured (`.scratch/ci-cd-github-actions/issues/10-branch-protection.md`,
Status `ready-for-human`, reopened 2026-09-26), so nothing in the repo would
stop a direct push to `main`. This doesn't necessarily mean CI was skipped —
PR #108's check-runs (the content that became `a1889fe`) were green — but the
merge mechanism itself isn't the one `docs/agents/verification.md` describes
("Push, open a PR... watch CI... Merge to `main` only when every job is
green").

**Fix:** accept, tracked. This is a symptom of the already-known "carry trap"
(handoff-2026-09-28.md) and of ticket 10 (branch protection) still being open;
no new ticket needed beyond making sure ticket 10 stays prioritized, since it
is the actual fix for "nothing stops a direct push."

### 6. [INFO] Vendored skills vs. plugin: still ambiguous, but by design

`.claude/skills/` still holds the full vendored Matt Pocock skill set (not
deleted). `CLAUDE.md` says the vendored copy is "cadangan sampai plugin
terbukti termuat di cloud session baru, lalu dihapus." `docs/agents/cloud-environment.md`'s
own first-session checklist still lists confirming the plugin loads as an
open check ("the vendored `/tdd` is only a fallback until that is proven").
Nothing in the repo shows this has been confirmed one way or the other yet.
Not a contradiction — the two docs agree — but it means the "salinan vendored
dihapus" step from `CLAUDE.md`'s workflow section has not actually happened,
and no artefact records that anyone checked. Category: accept (owner-gated,
not an agent-fixable gap), but worth a one-line status note next time someone
confirms it either way, so this doesn't sit open indefinitely.

## Things checked and found compliant

- **ADR format**: all 18 ADRs in `docs/adr/` use sequential numbering and the
  `status:` frontmatter key from `.claude/skills/domain-modeling/ADR-FORMAT.md`
  (`0003` correctly marked `superseded by ADR-0006`, matching `docs/agents/domain.md`'s
  own example).
- **Triage labels**: `docs/agents/triage-labels.md` matches the five roles
  CLAUDE.md names, plus the repo-specific `done` and `awaiting-merge` closing
  statuses, both used correctly where sampled.
- **Blocked-by discipline**: spot-checked `rilis-1-benda` 03/13/16/17 and
  `prd-compliance-fase-0-2` 27/28/32/33/35 — every blocked ticket that has
  *not* been dispatched still lists an unresolved blocker (e.g. ticket 33
  blocked on 30/32, still `ready-for-agent`, no PR exists for it); every
  dispatched one had its blockers `done` first. No violation found in the
  sample.
- **Wayfinder maps** (`rilis-1-benda`, `prd-audit`): follow
  `docs/agents/issue-tracker.md`'s claimed/resolved convention and the
  map/child-ticket shape correctly.

## Not evaluated

- The full universe of ~330 commits since 2026-09-26 was not individually
  diffed against ticket claims — only the money-PR sample (§ above) and the
  `.scratch/*/issues/*.md` Status lines were checked file-by-file. A
  systematic "every merged feature has a spec+ticket" sweep over the entire
  window would need a dedicated pass; nothing in the sample suggested a
  feature merged with no ticket at all (the gap found in #2 is a *wrong*
  citation, not a *missing* one).
