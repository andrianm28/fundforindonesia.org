import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Ticket 06 only records assignments; the Role hierarchy still governs
 * every access decision. This test pins that scope two ways: the exact
 * set of routes guarded by the hierarchy cannot shrink unnoticed, and
 * nothing may enforce assignments yet.
 *
 * Tickets 07-08 will extend these literals deliberately, one reviewed
 * diff at a time.
 *
 * NOTE (Task 3 reconciliation): the brief's pre-plan list of seven paths
 * did not match the tree as found. Three paths (`src/app/admin/...`)
 * never existed — the routes live under `src/app/api/admin/...`. Three
 * page files (`src/app/campaign/[slug]/page.tsx`,
 * `src/app/campaign/[slug]/donate/page.tsx`,
 * `src/app/moderasi/campaigns/[id]/page.tsx`) contain no hierarchy check
 * at all (public pages). Seven enforcing files missing from the brief's
 * list were added below. Verified with:
 * `grep -rln "withRoleCheck\|isAtLeast\|hasRole\|requireRole" src/app
 * src/components --include=*.ts --include=*.tsx | grep -v generated |
 * grep -v ".test." | sort`.
 */
const GUARDED_ROUTES = [
  "src/app/api/admin/reconcile/route.ts",
  "src/app/api/admin/users/[id]/role/route.ts",
  "src/app/api/admin/users/route.ts",
  "src/app/api/campaigns/[slug]/payouts/[id]/approve/route.ts",
  "src/app/api/campaigns/[slug]/payouts/route.ts",
  "src/app/api/campaigns/[slug]/route.ts",
  "src/app/api/campaigns/route.ts",
  "src/app/api/moderasi/campaigns/[id]/route.ts",
  "src/app/api/upload/route.ts",
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

describe("roles expand scope", () => {
  it("every guarded route still enforces the Role hierarchy", () => {
    const offenders = GUARDED_ROUTES.filter(
      (file) => !usesHierarchy(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });

  it("no route enforces assignments yet", () => {
    const offenders = walk("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          source.includes("prisma.userAssignment") ||
          source.includes("Assignment.VERIFIER") ||
          source.includes("Assignment.ADMIN")
        );
      });

    expect(offenders).toEqual([]);
  });

  it("the assignment model references ADR 0005", () => {
    expect(readFileSync("prisma/schema.prisma", "utf8")).toContain("ADR 0005");
  });
});
