# 02: Nothing writes the legacy status string

**What to build:**
- `transition()`, Campaign creation and the seed stop writing `status`.
- `toLifecycleStatus`/`toLegacyStatus` are deleted, which makes DRAFT writable. No Draft behaviour is added.
- The dual-write guard is replaced by a guard that nothing names the column.
- An additive migration makes `status` nullable with no default.
- The in-memory stand-in drops `status`.

See `.scratch/legacy-status-contract/spec.md`.

**Blocked by:** 01

**Status:** done

- [ ] No `src` or seed code writes or reads Campaign `status`; a guard test proves it
- [ ] The mapper and its tests are deleted, and no caller remains
- [ ] Migration: `status` becomes nullable with no default. It is applied to a fresh Postgres in a throwaway container, and `migrate diff` is empty
- [ ] Test rows no longer seed `status`. Full suite green, tsc adds no errors
