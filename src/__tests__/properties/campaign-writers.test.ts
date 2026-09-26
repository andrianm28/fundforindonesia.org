import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Who may write a Campaign row. Status moves only through the lifecycle
 * module (src/lib/campaign-lifecycle.ts); the other writers are creation,
 * the Fundraiser content edit and the Settlement webhook.
 *
 * Kept from the retired dual-write guard (legacy-status-contract 02): the
 * dual-write is gone, but a new Campaign writer still has to appear here,
 * visibly, in the diff.
 */
const WRITE = /(prisma|tx)\.campaign\.(create|update|upsert|createMany|updateMany)\b/;

const CAMPAIGN_WRITERS = [
  "src/app/api/campaigns/route.ts",
  "src/app/api/campaigns/[slug]/route.ts",
  "src/app/api/webhooks/[provider]/route.ts",
  "src/lib/campaign-lifecycle.ts",
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

describe("Campaign writers", () => {
  it("are exactly the known ones", () => {
    const writers = walk("src")
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => WRITE.test(readFileSync(file, "utf8")));

    expect(writers.sort()).toEqual([...CAMPAIGN_WRITERS].sort());
  });

  // Reaching the target does not close a Campaign (ADR 0004), and a late
  // Settlement must not overwrite a Suspension or a Cancellation: every
  // Campaign write in the Settlement webhook touches collectedAmount and
  // nothing else.
  it("the Settlement webhook's Campaign writes set only collectedAmount", () => {
    const source = readFileSync("src/app/api/webhooks/[provider]/route.ts", "utf8");
    const writes = source.match(new RegExp(`${WRITE.source}\\(\\{[\\s\\S]*?\\}\\);`, "g")) ?? [];

    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write).toMatch(/data:\s*\{\s*collectedAmount:\s*\{\s*increment:[^{}]*\}\s*\}/);
      expect(write).not.toMatch(/\bstatus\b|lifecycleStatus/);
    }
  });

  // lifecycleStatus defaults to SUBMITTED, so a seed that forgot it would
  // quietly hide every demo Campaign from the public listings.
  it("the seed sets each Campaign's lifecycleStatus", () => {
    expect(readFileSync("prisma/seed.ts", "utf8")).toContain("lifecycleStatus: campaignData.lifecycleStatus");
  });
});
