# 24: The deploy approval control the design assumes does not exist on Free

**What to build:** `.github/workflows/deploy.yml` and
`docs/agents/verification.md` both state that the `deploy` job "runs only
once the owner approves it as that environment's required reviewer", and
that an agent may dispatch the workflow but never approves its own
deployment. On GitHub Free there is no required reviewer for an
Environment, and `production` sits at `protection_rules: []`. The
`cloud-migration` plan already decided to "stay on GitHub Free, so the
GitHub environment step is dropped", so this is a known, deliberate
trade-off that the workflow's own comment has not caught up with.

What protects production today is the procedure: only the owner dispatches.
`ci/deploy-gate.sh` refuses a commit that is not on `main`, that has no
green CI run with all four jobs, or whose app and migrate images are not in
GHCR with matching provenance. So the risk is not malicious code running
itself, it is a deploy nobody approved.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The owner has chosen: accept the procedural control, or move to a plan
      that supports an Environment required reviewer
- [x] Whatever is chosen is written down where the next reader of
      `deploy.yml` will find it, instead of only in a plan from 2026-09-26
- [x] The comment at the top of `deploy.yml` and the matching paragraph in
      `docs/agents/verification.md` say what actually enforces this, rather
      than a control that does not exist
- [x] If the answer is "procedural", the standing rule is that no agent
      dispatches `deploy.yml`, and the decision is recorded in
      `CLAUDE.md` next to the existing rule about merges and GitHub settings

## Comments

- 2026-09-27 (relationship to ticket 24, which is done): ticket 24 split
  `deploy.yml` into a gate and an approval, and it deliberately removed the
  old "agents never dispatch it" rule, stating that "approval stays with the
  owner as environment reviewer". That design is sound and this ticket does
  not reopen it. What it could not have delivered is the reviewer itself:
  GitHub Free has no required reviewer for an Environment. So the half of
  ticket 24 that assumed one does not exist, and this ticket is the remainder
  of it. Nothing here is a criticism of 24; it is what 24 left out.
- 2026-09-27 (from the Rilis 1 plan, `.scratch/percepatan-rilis-1/plan.md`):
  found while re-checking what actually blocks the first production deploy.
  It is not a release blocker — the gate is real and the owner-only dispatch
  is a genuine control — so it is filed as a decision rather than an
  emergency, and deliberately **not** fixed by an agent: it changes GitHub
  settings, and the choice between paying for a plan and relying on
  procedure is the owner's.
- `ready-for-human`, not `ready-for-agent`, because both possible outcomes
  require the owner: one changes billing, the other changes a standing rule
  and workflow documentation.
- Ticket 23 (`production-environment`) is adjacent and still reads
  `ready-for-human` even though the Environment already exists. This ticket
  does not reopen it; it records what is still missing, which is the
  approval gate rather than the Environment.

- 2026-10-04: **keputusan owner "A + reviewer + protection".** Repo ini publik, jadi branch protection dan required reviewer environment gratis, dan premis tiket ("GitHub Free tidak punya required reviewer") sudah tidak berlaku. Tiga kontrol sekaligus: hanya owner yang men-dispatch `deploy.yml`; owner satu-satunya required reviewer environment `production`; dan `main` dilindungi branch protection (ci-cd 10). Agent, termasuk koordinator, tidak pernah men-dispatch maupun menyetujui deploy. Ini menggantikan kalimat di `CLAUDE.md`, `docs/agents/verification.md`, dan komentar `deploy.yml` yang mengizinkan agent men-dispatch; perubahan dokumen itu ada di PR housekeeping yang sama. Fakta GitHub terverifikasi di ci-cd 10 dan 23.
