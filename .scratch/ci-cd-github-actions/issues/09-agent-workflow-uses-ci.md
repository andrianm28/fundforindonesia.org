# 09: Agents verify through CI, not on the shared host

**What to build:** Document the working rule in `docs/agents/` and point to it from `CLAUDE.md`, using the `writing-for-agents` skill:
- run only the relevant tests locally;
- no full suite and no throwaway Docker on the host for routine checks;
- push the feature branch;
- `gh run watch` / `gh pr checks`;
- merge after green;
- production deploys only through the approved CD job.

**Blocked by:** 02

**Status:** done

- [ ] The rule and commands are in `docs/agents/`, with a pointer in `CLAUDE.md`
