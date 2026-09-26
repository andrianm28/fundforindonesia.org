# 01: One command runner inside the lifecycle module

**What to build:** The nine lifecycle commands stop hand-coding the shared sequence.
- An internal runner owns it: assignment and reason checks, lazy expiry in its own committed transaction, **lock the Campaign row then read it**, not-found, the own-Campaign rule, allowed effective statuses, the command's step, and the re-read.
- Each command becomes a declaration plus its own step. The command's `now` is used for every timestamp it writes.
- The exported interface of every command stays byte-for-byte the same: parameters, return types, error classes, codes and messages.

See spec `.scratch/lifecycle-runner-and-adapter/spec.md`, "Runner" and "Testing Decisions".

**Blocked by:** `.scratch/campaign-rule-bugs/issues/01` and `02` (merge first)

**Status:** done

- [ ] All nine commands go through one internal runner: decideSubmission, completeCampaign, requestCancellation, decideCancellation, suspendCampaign, liftSuspension, setUrgent, flagCampaign, dismissFlag. The order of checks is unchanged as observed from outside
- [ ] Every command takes the Campaign row lock before reading. The claim branches that the lock makes unreachable are deleted. `transition` keeps its predicated write
- [ ] `now` reaches every timestamp the commands write: the status log `createdAt`, the leave-Active hook's `decidedAt`, and Flag `resolvedAt`
- [ ] One table-driven test runs every command through its public interface for the cross-cutting cases:
  - not found, missing assignment, reason validation, own Campaign;
  - lazy expiry that persists when the command is refused;
  - a competing write committed before the lock is granted.

  The duplicated copies of those cases are deleted from the per-command test files
- [ ] Concurrency tests model only "committed before our lock". Tests that write inside a held lock are deleted. The in-memory stand-in records a lock for every command
- [ ] Time assertions check the exact `now`
- [ ] Full suite green, tsc adds no errors, and the static guards are updated, not weakened
