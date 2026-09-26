# Spec: Lifecycle command runner and HTTP adapter

Status: ready-for-agent
Source: architecture review of 2026-09-25 (candidates 2 and 1, "Top recommendation"). The grilling session decided Q1–Q10. Builds on `.scratch/campaign-status-transitions/spec.md` (C20, all tickets done). `CONTEXT.md`; ADR 0004, 0005, 0015.

## Problem Statement

C20 put every Campaign status change behind one module, but the module and its callers have been growing by copy:

- **Each command repeats the same sequence.** The lifecycle module has nine commands. Each one hand-codes the same steps: assignment check, reason, lazy expiry, transaction, read, not-owner check, effective-status check, write, log, notify, re-read.
- **Locking and time handling are inconsistent.**
  - Four commands lock the Campaign row before reading; five don't, and rely on a predicated write or an implicit UPDATE lock that only a code comment explains.
  - Every caller must remember to run lazy expiry before its own transaction.
  - The leave-Active hook stamps times with the server clock rather than the command's `now`, so the tests cannot assert them exactly.
- **Eight HTTP route modules repeat about 30 lines each, and the copies already disagree.**
  - Not-found comes in two shapes, one of them with no code.
  - Unexpected errors come in three shapes, one of them never logged.
  - Three routes answer a refusal with a bare English "Forbidden" before the command's Indonesian message can run.
- **Tests repeat the same cross-cutting cases per command and per route.** Some concurrency tests prove schedules Postgres would never allow.

For the Admins, Verifiers and Fundraisers who hit these endpoints, the visible symptom is that the same refusal reads differently depending on which button they pressed. For maintainers, every new command or route means copying the sequence again and hoping it is copied correctly.

## Solution

- **One internal command runner.** A runner inside the lifecycle module owns the shared sequence:
  1. lazy expiry, in its own committed transaction;
  2. open a transaction, **always lock the Campaign row, then read it**;
  3. check assignment and ownership, and validate the reason;
  4. check the allowed effective statuses;
  5. hand the locked Campaign, `now`, the reason and the actor to the command's own step;
  6. re-read the Campaign state.

  Each command becomes a small declaration plus that one step. `now` reaches every timestamp the commands write.
- **Unchanged exported interface.** Every command keeps its signature and typed errors, so callers and the command-level tests keep crossing the same seam.
- **One HTTP adapter.** It turns a request into a command call: session → actor, body parsing, slug → Campaign id, one error mapping (with logging and an Indonesian 500), and the success status. Each lifecycle route shrinks to a declaration of which command it calls with which input. The lifecycle routes stop using `withAssignmentCheck`, because the commands already check assignments with the right message.

Nobody sees a behaviour change except for three things: refusals now read the same on every route, 404s have one shape, and 500s are logged.

## User Stories

1. As an Admin, I want every lifecycle refusal to come back in Indonesian with a code, whichever endpoint I used, so that I always understand why I was refused.
2. As an Admin without the required assignment, I want the Indonesian "only an Admin can…" message instead of a bare "Forbidden", so that I know which assignment I lack.
3. As a Verifier, I want the same message shape from the moderation endpoint as from the Flag endpoint, so that the two screens behave alike.
4. As a Fundraiser, I want a missing Campaign to answer the same 404 shape everywhere, so that the UI can handle it once.
5. As an operator, I want every unexpected lifecycle error logged, so that a 500 is never silent.
6. As a user of any lifecycle endpoint, I want the same Indonesian 500 message everywhere, so that failures look consistent.
7. As an engineer, I want every lifecycle command to lock the Campaign row before reading it, so that nobody has to rediscover ordering rules from comments.
8. As an engineer, I want lazy expiry to run inside the runner, so that no command can forget it.
9. As an engineer, I want the command's `now` to be the timestamp of every row it writes (log entries, lapsed Cancellation requests, resolved Flags), so that tests can assert exact times and Lift orders deterministically.
10. As an engineer adding a new lifecycle command, I want to write only its declaration and its own step, so that I cannot get the shared sequence wrong.
11. As an engineer adding a new lifecycle route, I want to declare only its command and input, so that the HTTP handling is inherited, not copied.
12. As an engineer, I want the cross-cutting cases (not found, blank reason, missing assignment, own Campaign, lazy expiry, concurrent change) tested once across all commands, so that each command's test file holds only its own rules.
13. As an engineer, I want 401/404/500 handling tested once on the adapter, so that route tests only prove their request reaches the right command.
14. As an engineer, I want concurrency tests to model only schedules Postgres allows, so that a green test means something.
15. As an engineer, I want defensive branches that the lock makes unreachable deleted, so that the code shows only what can happen.
16. As a reviewer, I want each command's exported interface unchanged, so that callers and command-level tests need no edits beyond the deduplication.

## Implementation Decisions

### Runner (inside the lifecycle module, not exported)

- **What a command declares:**
  - the required assignment and capacity (FUNDRAISER-if-owner-else-ADMIN for completion, which is the one dual case);
  - the reason policy: required, optional, or none;
  - whether the own-Campaign rule applies;
  - the allowed effective statuses;
  - the step: a callback receiving a context of the transaction, the locked and read Campaign, `now`, the validated reason and the actor. The callback performs the command-specific write: a status transition, claiming a request or Flag, a side write such as Urgent or creating a Flag, and any notification.
- **Order of checks:**
  - before the transaction: assignment, then reason, both before anything is read;
  - lazy expiry, in its own committed transaction;
  - inside the transaction: lock, read, not found, own Campaign, allowed status, then the step.

  This preserves today's observable order, including 400 before 403-owner for a blank reason.
- **Locking:** every command takes the Campaign row lock (`SELECT … FOR UPDATE`) before reading, through one helper. The predicated write inside `transition` stays, because lazy expiry and the future scheduled expiry job (ticket 20) write status without the runner.
- **Unreachable branches deleted:** once the lock is held, the zero-rows branches of the Cancellation and Flag claims cannot be reached, so they are deleted. `ConcurrentTransitionError` remains for `transition`'s predicate.
- **`now` everywhere:** the runner's `now` is passed to `transition`, the leave-Active hook and every write. The status log's `createdAt` is set from `now` rather than the database default. Lapsed Cancellation requests get `decidedAt = now`, and resolved Flags get `resolvedAt = now`.
- **`CampaignNotFoundError`** carries `{ by: "id" | "slug", value }` instead of a `campaignId` field that sometimes holds a slug. Code and HTTP status are unchanged. The constructor stays source-compatible, `new CampaignNotFoundError(value, by = "id")`, so the runner keeps throwing it by id and the adapter throws it by slug. The adapter ticket makes this change; the runner ticket does not touch it.
- **Exported interface unchanged:** every command's parameters, return type, error classes, codes and messages stay the same. `expireIfPastDeadline`, `effectiveStatus`, the legacy mappings and `lifecycleErrorToHttp` also stay exported.

### HTTP adapter (new module, used by every lifecycle route)

- **What it owns:**
  - session → actor, answering 401 with a code;
  - safe JSON body parsing;
  - slug → Campaign id resolution, answering 404 through `CampaignNotFoundError` with `by: "slug"`;
  - the moderation route passes the id through unchanged;
  - mapping typed lifecycle errors through `lifecycleErrorToHttp`;
  - handling every other error: log it and answer one Indonesian 500 with a code;
  - the success status (200, or 201 for creation).
- **What a route declares:** which command to call, how to build its input from the parsed body and route params (including route-level input validation, raised as `LifecycleValidationError`), and its success status.
- **Scope:**
  - the complete, suspension (POST/DELETE), urgent, flags, flag dismiss, cancellation-requests, cancellation approve/reject and Verifier moderation routes use the adapter;
  - they no longer use `withAssignmentCheck`;
  - the roles-expand static guard's route list is updated to match;
  - the Campaign DELETE route and the money routes are **not** in scope.

## Testing Decisions

- **What makes a good test:** it asserts external behaviour through the module's interface (returned state, typed error, persisted rows, HTTP status and body), never which internal helper ran.
- **Lifecycle module:** the interface is the nine exported commands.
  - Add **one table-driven test** that runs every command through its public interface for the cross-cutting cases: not found, missing assignment, blank or over-long reason (where a reason applies), own Campaign (where that rule applies), lazy expiry that persists when the command is refused, and a concurrent change committed before the lock is granted.
  - Delete the copies of those cases from the per-command test files; each per-command file keeps only its own rules.
  - Tighten time assertions to the exact `now`.
  - Prior art: the existing campaign-lifecycle*.test.ts files and the in-memory stand-in.
- **Concurrency:**
  - Tests model a competing writer only as "committed before our lock was granted", using the stand-in's row-lock interleave hook.
  - Tests that script a write *inside* a held lock are deleted.
  - The write-interleave hook stays only for proving `transition`'s predicate through lazy expiry, which takes no lock.
  - The stand-in must record a lock for every command.
- **HTTP adapter:**
  - Tested once, directly: 401, malformed body, slug not found, typed-error mapping for every lifecycle code, unexpected error logged and answered 500, success status.
  - Each lifecycle route test shrinks to proving that its request reaches the right command with the right input and success status, plus any route-specific validation.
  - Prior art: the existing lifecycle route tests.
- **Guards:** the dual-write, urgent-single-writer and roles-expand guards stay green. They are updated, not weakened.

## Out of Scope

- Candidate 3 (one effective-status reader for the catalogue).
- Candidate 4 (a Campaign guard shared with the money modules; ticket 30's Suspension effects).
- Candidate 5 (narrowing the persistence seam and replacing the in-memory stand-in).
- Candidate 6 (Campaign DELETE as a lifecycle command; deleting `api-errors.ts`).
- The two live defects found by the review. They are fixed separately in `.scratch/campaign-rule-bugs/` and must merge first.
- Any change to what a command allows or refuses.
- Volunteer Trip moderation.

## Further Notes

- **Order:** land `.scratch/campaign-rule-bugs/` tickets 01 and 02 first. The runner and adapter tickets can then run in parallel. They meet only at `CampaignNotFoundError`, whose shape is fixed above.
- **Candidate 5 depends on this:** the runner is the natural place for a narrower persistence seam, so candidate 5 is evaluated after this lands.
