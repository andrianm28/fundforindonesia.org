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
 *
 * NOTE (capacity-judgement ticket 03): Admin power comes only from the
 * ADMIN assignment. The Campaign, Trip and Batch edit routes ask
 * `refuseUnlessFundraiserOrAdmin` (src/lib/refusal-response.ts), which
 * holds their one remaining CAMPAIGN_CREATOR check for the Fundraiser
 * path, so that file replaces the Campaign PATCH route below. The admin
 * pages join the assignment readers, and NO_ADMIN_BY_ROLE pins that no
 * file grants Admin from the Role any more.
 *
 * NOTE (campaign-rule-bugs ticket 04): the middleware gates /moderasi on
 * the VERIFIER assignment too, so no Role rank decides who reaches the
 * moderation pages ahead of moderasi/layout.tsx.
 *
 * NOTE (retire-role-hierarchy ticket 01): anyone registered may submit a
 * Campaign or Volunteer Trip (PRD FFI-04), and a Payout needs ownership,
 * not a Role. Every CAMPAIGN_CREATOR gate is gone -- the create, Trip
 * create and Payout routes, refusal-response.ts, the middleware and the
 * create, account and Kampanye Saya pages -- and CAMPAIGN_CREATOR_GATE
 * pins it.
 *
 * NOTE (retire-role-hierarchy ticket 02): the hierarchy itself is gone:
 * roles.ts, withRoleCheck and the Role route and editor are deleted, and
 * the upload route asks only for a signed-in user. usesHierarchy below now
 * matches nothing in src; src/__tests__/user-role-readers.test.ts pins
 * that no code names the User role column either.
 *
 * NOTE (csr-01): POST /api/programs and PATCH /api/programs/[slug] let an
 * Admin create and edit CSR Programs, each through withAssignmentCheck on
 * the ADMIN assignment -- growing this list by two.
 *
 * NOTE (csr-06): the partnership team's Inquiry queue and the one door that
 * moves a follow-up forward -- `GET /api/admin/partnership-inquiries` and
 * `PATCH /api/admin/partnership-inquiries/[id]` -- are Admin routes through
 * `withAssignmentCheck` on the ADMIN assignment, like every other route here:
 * a queue of companies and the people at them is nobody else's to read, and
 * growing this list by two.
 *
 * NOTE (prd-compliance 14): POST /api/admin/duplicate-similarity lets an
 * Admin set the title similarity a Verifier's duplicate hints are built on
 * (PRD FFI-05), through withAssignmentCheck on the ADMIN assignment like
 * every other Admin setting here -- growing this list by one.
 *
 * NOTE (csr-04): the Program edit was keyed by id when csr-01 landed, and the
 * public portfolio read needed the same segment for the slug a public link can
 * carry. Next.js allows one dynamic segment per level, so the segment is the
 * slug, as it already is for a Campaign, and PATCH resolves it before calling
 * the module. The assignment guard is unaffected: GET is public by design (a
 * Program is a catalog entry with nothing to gate), and only PATCH is wrapped.
 */

const ASSIGNMENT_GUARDED_ROUTES = [
  "src/app/admin/layout.tsx",
  "src/app/admin/page.tsx",
  "src/app/api/admin/duplicate-similarity/route.ts",
  "src/app/api/admin/partnership-inquiries/[id]/route.ts",
  "src/app/api/admin/partnership-inquiries/route.ts",
  "src/app/api/admin/platform-fee/route.ts",
  "src/app/api/admin/reconcile/route.ts",
  "src/app/api/admin/users/[id]/assignments/route.ts",
  "src/app/api/admin/users/route.ts",
  "src/app/api/campaigns/[slug]/payouts/[id]/approve/route.ts",
  "src/app/api/campaigns/[slug]/refunds/[id]/approve/route.ts",
  "src/app/api/campaigns/[slug]/refunds/route.ts",
  "src/app/api/moderasi/volunteer-trips/[id]/route.ts",
  "src/app/api/moderasi/volunteer-trips/route.ts",
  "src/app/api/programs/[slug]/route.ts",
  "src/app/api/programs/route.ts",
  "src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.ts",
  "src/app/api/volunteer-trips/[slug]/refunds/[id]/approve/route.ts",
  "src/app/moderasi/layout.tsx",
  "src/app/moderasi/page.tsx",
  // Not a route: the Capacity judgement, which the lifecycle module, the
  // money operations and Trip moderation ask, because "owner or Admin" and
  // "never Admin on your own Campaign or Trip" are not single-assignment
  // checks a route wrapper can express.
  "src/lib/capacity.ts",
  // Not a route: requireNotOwnerAsAdmin asks the judgement for the money
  // operations, whose routes have already required ADMIN.
  "src/lib/subject-guard.ts",
  // Not a route: checklistRoute wraps every Admin checklist-editor route
  // (src/app/api/admin/verification-checklist/**) in the ADMIN assignment
  // check (verification-request 04).
  "src/lib/verification-checklist-route.ts",
  // Not a route: partnerOrganisationRoute wraps every route of the
  // Verifier's Partner Organisation register
  // (src/app/api/moderasi/partner-organisations/**) in the VERIFIER
  // assignment check (prd-compliance 10).
  "src/lib/partner-organisation-route.ts",
  // Not a route: who may view an unapproved Campaign (its Fundraiser, or
  // anyone holding VERIFIER or ADMIN), which GET /api/campaigns/[slug] asks
  // for every viewer, so no route wrapper can require one assignment.
  "src/lib/campaign-visibility.ts",
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

/**
 * Granting Admin power from the legacy Role: comparing a session's or
 * token's role to ADMIN, or asking the hierarchy for ADMIN. The role
 * route's own `role !== "ADMIN"` compares the Role being SET, not the
 * caller's, so it is not a grant and does not match.
 */
const ADMIN_BY_ROLE =
  /(\.role|\buserRole)\s*[!=]==?\s*["']ADMIN["']|\b(isAtLeast|hasRole|requireRole)\([^)]*["']ADMIN["']|\bwithRoleCheck\(\s*["']ADMIN["']|minimumRole:\s*["']ADMIN["']/;

/**
 * Gating on the legacy CAMPAIGN_CREATOR Role: the route wrapper, a rank
 * comparison, a middleware rank route, the old owner-route gate, or
 * branching on whether a session is a DONOR or a CAMPAIGN_CREATOR.
 */
const CAMPAIGN_CREATOR_GATE =
  /\bwithRoleCheck\(\s*["']CAMPAIGN_CREATOR["']|\b(isAtLeast|hasRole|requireRole)\([^)]*["']CAMPAIGN_CREATOR["']|minimumRole:\s*["']CAMPAIGN_CREATOR["']|\blegacyCampaignCreatorGate\b|(\.role|\buserRole)\s*[!=]==?\s*["'](DONOR|CAMPAIGN_CREATOR)["']/;

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

  it("catches a legacy Admin grant (the guard's own check)", () => {
    expect('session.user.role !== "ADMIN"').toMatch(ADMIN_BY_ROLE);
    expect("const isAdmin = userRole === 'ADMIN';").toMatch(ADMIN_BY_ROLE);
    expect("isAtLeast(userRole, 'ADMIN')").toMatch(ADMIN_BY_ROLE);
    expect('withRoleCheck("ADMIN", handler)').toMatch(ADMIN_BY_ROLE);
    expect('{ pattern: "/admin", minimumRole: "ADMIN" }').toMatch(ADMIN_BY_ROLE);
    expect('if (session!.user.id === id && role !== "ADMIN") {').not.toMatch(ADMIN_BY_ROLE);
    expect("isAtLeast(userRole, 'CAMPAIGN_CREATOR')").not.toMatch(ADMIN_BY_ROLE);
  });

  it("no file grants Admin power from the legacy Role (ADR 0005)", () => {
    const offenders = walk("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => ADMIN_BY_ROLE.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("catches a CAMPAIGN_CREATOR gate (the guard's own check)", () => {
    expect("export const POST = withRoleCheck('CAMPAIGN_CREATOR', async () => {").toMatch(CAMPAIGN_CREATOR_GATE);
    expect("if (!isAtLeast(user?.role, 'CAMPAIGN_CREATOR')) {").toMatch(CAMPAIGN_CREATOR_GATE);
    expect('{ pattern: "/campaign/create", minimumRole: "CAMPAIGN_CREATOR" }').toMatch(CAMPAIGN_CREATOR_GATE);
    expect("return legacyCampaignCreatorGate(user) ?? refusal;").toMatch(CAMPAIGN_CREATOR_GATE);
    expect("{user?.role === 'DONOR' ? (").toMatch(CAMPAIGN_CREATOR_GATE);
    expect('<option value="CAMPAIGN_CREATOR">Kreator Kampanye</option>').not.toMatch(CAMPAIGN_CREATOR_GATE);
  });

  it("no file gates on the CAMPAIGN_CREATOR Role or account type: anyone registered may submit (FFI-04)", () => {
    const offenders = walk("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => CAMPAIGN_CREATOR_GATE.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("the middleware decides no route by Role rank", () => {
    const source = readFileSync("src/proxy.ts", "utf8");
    expect(source).not.toContain("minimumRole");
    expect(source).not.toContain("ROLE_LEVELS");
  });

  it("the middleware gates /admin on the ADMIN assignment the session token carries", () => {
    const source = readFileSync("src/proxy.ts", "utf8");
    expect(source).toMatch(/pattern:\s*"\/admin",\s*assignment:\s*"ADMIN"/);
    expect(source).toContain("token?.assignments");
  });

  it("the middleware gates /moderasi on the VERIFIER assignment, never on a Role rank", () => {
    const source = readFileSync("src/proxy.ts", "utf8");
    expect(source).toMatch(/pattern:\s*"\/moderasi",\s*assignment:\s*"VERIFIER"/);
    expect(source).not.toMatch(/pattern:\s*"\/moderasi",\s*minimumRole:/);
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
