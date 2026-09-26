# 02: One HTTP adapter for every lifecycle route

**What to build:** Every lifecycle route answers the same way because one adapter module does the HTTP work:
- session → actor (401);
- safe body parsing;
- slug → Campaign id (404 with one shape);
- typed-error mapping;
- logging plus one Indonesian 500 for anything unexpected;
- the success status.

Each route shrinks to a declaration of its command, its input and its success status. The lifecycle routes stop using `withAssignmentCheck`, so a missing assignment gets the command's Indonesian message rather than a bare "Forbidden". `CampaignNotFoundError` gains `{ by: "id" | "slug", value }` with a source-compatible constructor. See spec `.scratch/lifecycle-runner-and-adapter/spec.md`, "HTTP adapter" and "Testing Decisions".

**Blocked by:** `.scratch/campaign-rule-bugs/issues/01` and `02` (merge first)

**Status:** done

- [ ] One adapter module is used by these routes, and none of them uses `withAssignmentCheck` any more: complete, suspension (POST and DELETE), urgent, flags, flag dismiss, cancellation-requests, cancellation approve/reject, and Verifier moderation
- [ ] 404 for an unknown slug has one shape everywhere, with code `CAMPAIGN_NOT_FOUND` and `by: "slug"`
- [ ] Every unexpected error is logged and answered with one Indonesian 500 with a code
- [ ] Route-level input validation (urgent's boolean, the moderation action) raises `LifecycleValidationError`
- [ ] The adapter is tested once for 401, malformed body, unknown slug, every lifecycle error code, and a logged 500. Each route test shrinks to "reaches the right command with the right input and status", plus its own validation
- [ ] The roles-expand guard is updated. Full suite green, tsc adds no errors
- [ ] The Campaign DELETE route and the money routes are untouched
