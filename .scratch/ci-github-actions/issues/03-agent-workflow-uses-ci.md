# 03: Agents verify through CI, not on the shared host

**What to build:** Document the new working rule in `docs/agents/` and add a short pointer in `CLAUDE.md`, using the `writing-for-agents` skill:
- run only the tests relevant to the change locally;
- never start throwaway Docker Postgres containers or the full suite on the host for routine checks;
- push the feature branch;
- read results with `gh run watch` / `gh pr checks`;
- merge to `main` only after CI is green.

The reason is the shared host's load (`.scratch/ci-github-actions/spec.md`).

**Blocked by:** 01

**Status:** wontfix

- [ ] `docs/agents/` holds the rule and the commands
- [ ] `CLAUDE.md` points to it in one or two lines
- [ ] The existing `/implement` flow notes that the full-suite step happens in CI
