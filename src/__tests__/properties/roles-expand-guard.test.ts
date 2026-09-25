import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Ticket 06 only recorded assignments; ticket 07 makes several of them
 * decide access. This test pins the boundary three ways: the four files
 * that still legitimately gate on account type (CAMPAIGN_CREATOR/DONOR,
 * which have no Assignment equivalent) still enforce the Role hierarchy;
 * the Admin/Verifier files no longer decide access by hierarchy at
 * all; and exactly those files, and no others, decide access by
 * assignment. Ticket 08 removes the hierarchy entirely -- these literals
 * will shrink to nothing then, not grow.
 *
 * NOTE (ticket 06, Task 3 reconciliation): the brief's pre-plan list of
 * seven paths did not match the tree as found. Three paths
 * (`src/app/admin/...`) never existed -- the routes live under
 * `src/app/api/admin/...`. Three page files
 * (`src/app/campaign/[slug]/page.tsx`,
 * `src/app/campaign/[slug]/donate/page.tsx`,
 * `src/app/moderasi/campaigns/[id]/page.tsx`) contain no hierarchy check
 * at all (public pages).
 *
 * NOTE (Volunteer Trip plan, Task 3): adds the Verifier moderation queue
 * for Volunteer Trips (`GET`/`PATCH /api/moderasi/volunteer-trips[/[id]]`),
 * mirroring the existing Campaign moderation routes above -- growing this
 * list from seven to nine, same as Campaign's own moderation routes did.
 *
 * NOTE (Trip Fee Payout plan, Task 3): adds
 * `POST /api/volunteer-trips/[slug]/payouts/[id]/approve`, mirroring the
 * existing Campaign payout approve route above -- growing this list from
 * nine to ten.
 *
 * NOTE (Refund API plan, Task 3): adds
 * `POST /api/campaigns/[slug]/refunds` and
 * `PATCH /api/campaigns/[slug]/refunds/[id]/approve`, both Admin-only on
 * both ends -- growing this list from ten to twelve.
 *
 * NOTE (lifecycle HTTP adapter, ticket 02): the urgent, Cancellation
 * decision and Submission decision routes no longer gate on an assignment
 * themselves. Like every lifecycle route they go through `lifecycleRoute`,
 * and the lifecycle module checks the assignment with the command's own
 * Indonesian refusal -- shrinking this list by three. LIFECYCLE_ROUTES pins
 * that no lifecycle route falls back to a route-level gate.
 */
const HIERARCHY_GUARDED_ROUTES = [
  "src/app/api/campaigns/[slug]/payouts/route.ts",
  "src/app/api/campaigns/[slug]/route.ts",
  "src/app/api/campaigns/route.ts",
  "src/app/api/upload/route.ts",
];

const ASSIGNMENT_GUARDED_ROUTES = [
  "src/app/api/admin/reconcile/route.ts",
  "src/app/api/admin/users/[id]/assignments/route.ts",
  "src/app/api/admin/users/[id]/role/route.ts",
  "src/app/api/admin/users/route.ts",
  "src/app/api/campaigns/[slug]/payouts/[id]/approve/route.ts",
  "src/app/api/campaigns/[slug]/refunds/[id]/approve/route.ts",
  "src/app/api/campaigns/[slug]/refunds/route.ts",
  "src/app/api/moderasi/volunteer-trips/[id]/route.ts",
  "src/app/api/moderasi/volunteer-trips/route.ts",
  "src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.ts",
  "src/app/api/volunteer-trips/[slug]/refunds/[id]/approve/route.ts",
  "src/app/moderasi/layout.tsx",
  "src/app/moderasi/page.tsx",
  // Not a route: the Campaign lifecycle module authorizes each transition
  // itself, because "owner or Admin" and "never Admin on your own Campaign"
  // are not single-assignment checks a route wrapper can express.
  "src/lib/campaign-lifecycle.ts",
];

/** Every route that changes a Campaign's lifecycle through the lifecycle module. */
const LIFECYCLE_ROUTES = [
  "src/app/api/campaigns/[slug]/cancellation-requests/[id]/decide.ts",
  "src/app/api/campaigns/[slug]/cancellation-requests/route.ts",
  "src/app/api/campaigns/[slug]/complete/route.ts",
  "src/app/api/campaigns/[slug]/flags/[id]/dismiss/route.ts",
  "src/app/api/campaigns/[slug]/flags/route.ts",
  "src/app/api/campaigns/[slug]/suspension/route.ts",
  "src/app/api/campaigns/[slug]/urgent/route.ts",
  "src/app/api/moderasi/campaigns/[id]/route.ts",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function usesHierarchy(source: string): boolean {
  return (
    source.includes("withRoleCheck") ||
    source.includes("isAtLeast") ||
    source.includes("hasRole") ||
    source.includes("requireRole")
  );
}

function usesAssignment(source: string): boolean {
  return (
    source.includes("prisma.userAssignment") ||
    source.includes("Assignment.VERIFIER") ||
    source.includes("Assignment.ADMIN")
  );
}

describe("roles expand scope", () => {
  it("the four account-type routes still enforce the Role hierarchy", () => {
    const offenders = HIERARCHY_GUARDED_ROUTES.filter(
      (file) => !usesHierarchy(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });

  it("the Admin/Verifier files no longer decide access by hierarchy", () => {
    const offenders = ASSIGNMENT_GUARDED_ROUTES.filter(
      (file) => usesHierarchy(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });

  it("exactly the Admin/Verifier files decide access by assignment", () => {
    const readers = walk("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => usesAssignment(readFileSync(file, "utf8")));

    expect(readers.sort()).toEqual([...ASSIGNMENT_GUARDED_ROUTES].sort());
  });

  it("every lifecycle route goes through the lifecycle adapter, never a route-level gate", () => {
    const offenders = LIFECYCLE_ROUTES.filter((file) => {
      const source = readFileSync(file, "utf8");
      return !source.includes("lifecycleRoute(") || source.includes("withAssignmentCheck") || usesHierarchy(source);
    });

    expect(offenders).toEqual([]);
  });

  it("the assignment model references ADR 0005", () => {
    expect(readFileSync("prisma/schema.prisma", "utf8")).toContain("ADR 0005");
  });
});
