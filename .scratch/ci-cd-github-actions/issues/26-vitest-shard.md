# 26: Shard the vitest job three ways

**What to build:** The `test` job in `.github/workflows/ci.yml` runs the whole
vitest suite on one runner and is the longest job on the critical path. Split
it into three vitest shards (`--shard=i/3`) that run in parallel, each on its
own runner with its own Postgres service (the real-DB tests read
`TEST_DATABASE_URL`, and runners do not share a database).

Branch protection on `main` requires a check named exactly `test`, and
`ci/deploy-gate.sh` matches jobs by exact name (`grep -qx`) against `test`,
`build`, `migrations`, `ratchet`. So the shards get their own names
(`test-shard (i/3)`) and an aggregate job named exactly `test` `needs` all of
them and fails unless every shard succeeded (it runs `if: always()`, so a
failed or cancelled shard turns it red instead of leaving it skipped, which
branch protection would read as passing). No other check is renamed, and
`deploy-gate.sh` needs no change: the shard names cannot satisfy its `test`
match, and a skipped aggregate is refused like any other non-success job.
`cd.yml` is untouched.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `ci.yml` has a `test-shard` matrix job (shards 1..3 of 3, `fail-fast: false`), each with its own Postgres service and `TEST_DATABASE_URL`
- [ ] A job named exactly `test` needs the shards and fails when any shard did not succeed
- [ ] Names `build`, `migrations`, `ratchet`, `e2e` unchanged
- [ ] `deploy-gate.test.ts` proves a run whose shards are green but whose `test` aggregate is not green is refused
- [ ] `workflows.test.ts` pins the wiring above
- [ ] `docs/agents/verification.md` describes the shards
- [ ] Median duration of `test` before and after recorded (visible only in CI after merge)

## Comments

- 2026-10-04: owner approved this ticket.
- Duration estimate (to be confirmed from CI): the full suite is one
  runner's serial-ish workload; three shards should cut the `test` wall time
  to roughly 40 percent of it (about 1/3 plus a fixed `npm ci` and
  `prisma generate` cost per shard), at three times the runner minutes for
  that job. Median before and after is to be read off CI runs once this is on
  `main`.
