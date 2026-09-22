import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Ticket 06 only recorded assignments; ticket 07 makes seven of them
 * decide access. This test pins the boundary three ways: the four files
 * that still legitimately gate on account type (CAMPAIGN_CREATOR/DONOR,
 * which have no Assignment equivalent) still enforce the Role hierarchy;
 * the seven Admin/Verifier files no longer decide access by hierarchy at
 * all; and exactly those seven, and no others, decide access by
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
  "src/app/api/moderasi/campaigns/[id]/route.ts",
  "src/app/moderasi/layout.tsx",
  "src/app/moderasi/page.tsx",
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

  it("the seven Admin/Verifier files no longer decide access by hierarchy", () => {
    const offenders = ASSIGNMENT_GUARDED_ROUTES.filter(
      (file) => usesHierarchy(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });

  it("exactly the seven Admin/Verifier files decide access by assignment", () => {
    const readers = walk("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => usesAssignment(readFileSync(file, "utf8")));

    expect(readers.sort()).toEqual([...ASSIGNMENT_GUARDED_ROUTES].sort());
  });

  it("the assignment model references ADR 0005", () => {
    expect(readFileSync("prisma/schema.prisma", "utf8")).toContain("ADR 0005");
  });
});
