import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every "only the owner may…" route asks the Capacity judgement for the
 * FUNDRAISER Capacity (src/lib/capacity.ts, through `refuseUnlessFundraiser`)
 * instead of comparing the owner by hand, so every such refusal is the same
 * 403 NOT_AUTHORIZED (capacity-judgement ticket 02). This pins it per
 * handler: a hand-written `creatorId === …` / `fundraiserId !== …` in any of
 * them fails here. Only the listed handlers are read, so a file's other
 * code (the Campaign GET's owner-only suspension reason, which is a
 * visibility rule, not a refusal) is not in scope.
 */
const OWNER_ONLY_HANDLERS: Array<[file: string, handler: string]> = [
  ["src/app/api/campaigns/[slug]/route.ts", "PATCH"],
  ["src/app/api/campaigns/[slug]/updates/route.ts", "POST"],
  ["src/app/api/campaigns/[slug]/payouts/route.ts", "POST"],
  ["src/app/api/volunteer-trips/[slug]/payouts/route.ts", "POST"],
  ["src/app/api/volunteer-trips/[slug]/payouts/route.ts", "GET"],
  ["src/app/api/volunteer-trips/[slug]/route.ts", "PATCH"],
  ["src/app/api/volunteer-trips/[slug]/batches/route.ts", "POST"],
  ["src/app/api/volunteer-trips/[slug]/batches/[id]/route.ts", "PATCH"],
];

const OWNER_COMPARISON =
  /\b(creatorId|fundraiserId)\s*[!=]==|[!=]==\s*[\w.?!]*\b(creatorId|fundraiserId)\b/;

/** The source of one exported handler, up to the next top-level export. */
function handlerSource(file: string, handler: string): string {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  const start = source.search(new RegExp(`^export (async function|const) ${handler}\\b`, "m"));
  if (start === -1) throw new Error(`${file} has no exported ${handler}`);
  const next = source.slice(start + 1).search(/^export /m);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe("owner-only routes ask the Capacity judgement", () => {
  it("catches a hand-written owner comparison (the guard's own check)", () => {
    expect("if (campaign.creatorId !== session.user.id) {").toMatch(OWNER_COMPARISON);
    expect("trip.fundraiserId === session.user.id").toMatch(OWNER_COMPARISON);
    expect("session.user.id !== campaign.creatorId").toMatch(OWNER_COMPARISON);
    expect("{ kind: 'trip', ownerId: trip.fundraiserId }").not.toMatch(OWNER_COMPARISON);
  });

  it.each(OWNER_ONLY_HANDLERS)("%s %s compares no owner by hand", (file, handler) => {
    expect(handlerSource(file, handler)).not.toMatch(OWNER_COMPARISON);
  });

  it.each(OWNER_ONLY_HANDLERS)("%s %s asks refuseUnlessFundraiser", (file, handler) => {
    expect(handlerSource(file, handler)).toContain("refuseUnlessFundraiser(");
  });
});
