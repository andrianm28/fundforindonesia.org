# Handoff: FFI coordinator, v1 release push (2026-09-27)

Written by the opus coordinator session (cloud) through `/handoff`. The owner
asked for it to live in the repo. Read first: `CLAUDE.md` (it imports
`AGENTS.md`, the agent tiering rules), then this file. The owner is **Dri**:
address them as Dri and reply in Indonesian.

## How this coordinator works (owner decisions, 2026-09-26/27)

- The coordinator runs on opus. Builders run as **background subagents in the
  coordinator session** (Agent tool, `isolation: worktree`, `model: sonnet`),
  at most **4** at once. Only use separate cloud sessions if Dri asks.
- `implement`, `to-tickets`, `to-spec`, `handoff`, `triage` and the other
  `disable-model-invocation` skills are owner-only. Builders run `tdd` then
  `code-review` themselves. The coordinator writes ticket files by hand.
- Subagents cannot dispatch subagents, so the coordinator dispatches the
  independent reviewer (sonnet; haiku for re-review). Money, security and
  concurrency code always gets one.
- Before dispatching a builder, check that every ticket on its "Blocked by"
  line is `done` (ticket 25 was dispatched too early once).
- Explicit "ya" from Dri is needed for every merge. Merge only on a green head,
  with `expectedHeadSha` set to the full 40-char sha.
- Token budget is tight: about $100 of credit remained at the start of
  2026-09-27. Sonnet ticket runs cost $4–12 each. Keep reports short and do
  not narrate routine notifications.
- CI runs locally with `npm run ci:local [-- job…]` (`ci/local.sh`). Actions
  minutes are free because the repo is public.
- Sub-sessions spawned with `create_session` cannot be messaged from the
  coordinator. Dri answers their questions in the app.

## State at handoff

Merged 2026-09-26/27 (details in each PR): #33 Platform Fee, #35 hook `npm ci`,
#37–#43 cleanup, runner pin, Next 16 (#41), #44 ticket 18 QRIS donation,
#45 local CI and test cleanup, #47/#48 VR 09/10, #49/#50 production-environment
spec and the deploy gate→approval split, #51 ticket 19 escrow anchor (Sumopod
fallback T+2, owner decision recorded in `docs/integrasi-sumopod.md`),
#52 ticket 21 Receipt.

In flight (check each on arrival; none may be merged without Dri's "ya"):

| Work | Where | Next step |
| --- | --- | --- |
| #56 AGENTS.md tiering + statuses 19/21/ci-cd 24 done | branch `claude/cool-shannon-t1rqdr` | CI, then ask to merge |
| prd 22 Akad Wakaf | cloud session `session_01JdTy6p5bfGwiVXvu7WSHgt` | PR → CI → ask to merge |
| prd 20 scheduled jobs | cloud session `session_01HCLXPf31tN9w4oorHg2jeQ` | PR → independent sonnet review (money/concurrency) → ask |
| prd 24 Traffic Source | background subagent, branch `claude/traffic-source-24` | PR → sonnet review → ask |
| prd 16 encryption migrate-contract | background subagent, branch `claude/encryption-migrate-contract-16` | PR → sonnet security review; the contract step needs an owner-run production backfill |
| ci-cd 19 middleware→proxy | background subagent, branch `claude/middleware-to-proxy-19` | PR → review (auth) → ask |
| CSR + Hibah tickets | background subagent, branch `claude/csr-hibah-tickets` | PR of `.scratch/csr-and-hibah/issues/` → Dri reviews the ticket list |

Background subagents belong to the old session. If a branch has no PR when you
start, re-dispatch that ticket rather than waiting on the old agent.

## v1 path (definition: all six modules; Fase 1 gate = one real QRIS donation + Receipt)

Ticket order, dispatched as blockers allow:

- **Donasi:** after 20, run 25 (Impact), then 26 (hide Demo). 23 (guest history) waits on 16.
- **Wakaf:** 22 is in flight.
- **Hibah / CSR:** from the tickets being drafted. Hibah documents wait on the syariah review (ADR 0013).
- **Volunteer / Galang Dana:** code done; verify after deploy.
- **Deferred:** ci-cd 17, 18, 20–22 (lint rules, Tailwind 4, framer-motion, dotenv); Dependabot #11/#13/#14/#46; Escrow override for disaster Campaigns; rate limit on donation retry.

## Owner-only path (no agent work)

1. Ticket 23 (production environment and secrets) and ticket 10 (branch
   protection): `.scratch/ci-cd-github-actions/`.
2. Sumopod credentials (`percepatan-produksi/01`) and YIEM as Collecting
   Entity (`percepatan-produksi/02`).
3. Cutover (`ci-cd-github-actions/issues/08`, `.scratch/deploy-readiness.md`).
4. Dispatch `deploy.yml`, then approve it in the `production` environment.
5. One real QRIS donation, with its Receipt.
6. Add `gh` to the environment setup script's `apt-get` line.

## Open questions for Dri

- Whether the plugin "Skills For Real Engineers" really loads in a fresh cloud
  session. This session only ever saw the vendored `.claude/skills/`; keep the
  vendored copy until that is proven (`CLAUDE.md`).
- The Claude Docs "Roadmap FFI" artifact is stale (before #19). Refresh it only
  if Dri asks.

## Suggested skills

- `tdd` and `code-review`: every builder brief and every review.
- `resolving-merge-conflicts`: in-flight branches will collide on
  `CampaignDetailView`, the webhooks route and the migrations.
- `diagnosing-bugs`: any red CI that isn't obvious.
- `domain-modeling`: new policy (Hibah, Escrow override) in `CONTEXT.md` and ADRs.
- `wizard`: if Dri wants a guided script for the cutover or tickets 23/10.
- `writing-for-agents`: edits to `CLAUDE.md` / `AGENTS.md`.
