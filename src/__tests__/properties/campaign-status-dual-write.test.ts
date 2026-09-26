import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The `status` string and the `lifecycleStatus` enum must never diverge:
 * every write that sets one sets the other through `toLifecycleStatus`.
 * This test exists so a new writer cannot reintroduce a silent split.
 *
 * If a write legitimately sets neither column, add it to
 * WRITES_WITHOUT_STATUS as a named literal that a reviewer sees in the diff.
 */
const WRITE = /(prisma|tx)\.campaign\.(create|update|upsert|createMany|updateMany)\b/;

// The Fundraiser content edit: its zod schema admits no status field, so it
// writes neither column (status moves through src/lib/campaign-lifecycle.ts).
// The Settlement webhook: it only increments collectedAmount, because reaching
// the target does not close a Campaign (ADR 0004) and a late Settlement must
// not overwrite a Suspension or a Cancellation.
const WRITES_WITHOUT_STATUS = [
  "src/app/api/campaigns/[slug]/route.ts",
  "src/app/api/webhooks/[provider]/route.ts",
];

// Every src file that writes a Campaign row at all. Status transitions live
// in the lifecycle module; the others are creation, the content edit and the
// Settlement webhook. A new writer has to be added here, visibly, in the diff.
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

describe("Campaign status dual-write", () => {
  it("every src file that writes a Campaign also writes lifecycleStatus", () => {
    const offenders = walk("src")
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !WRITES_WITHOUT_STATUS.includes(file))
      .filter((file) => WRITE.test(readFileSync(file, "utf8")))
      .filter((file) => !readFileSync(file, "utf8").includes("lifecycleStatus"));

    expect(offenders).toEqual([]);
  });

  // Its WRITES_WITHOUT_STATUS entry is not a blanket pass: every Campaign
  // write in the Settlement webhook must touch collectedAmount and nothing else.
  it("the Settlement webhook's Campaign writes set only collectedAmount", () => {
    const source = readFileSync("src/app/api/webhooks/[provider]/route.ts", "utf8");
    const writes = source.match(new RegExp(`${WRITE.source}\\(\\{[\\s\\S]*?\\}\\);`, "g")) ?? [];

    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write).toMatch(/data:\s*\{\s*collectedAmount:\s*\{\s*increment:[^{}]*\}\s*\}/);
      expect(write).not.toMatch(/\bstatus\b|lifecycleStatus/);
    }
  });

  it("the Campaign writers are exactly the known ones", () => {
    const writers = walk("src")
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => WRITE.test(readFileSync(file, "utf8")));

    expect(writers.sort()).toEqual([...CAMPAIGN_WRITERS].sort());
  });

  it("the seed writes lifecycleStatus", () => {
    expect(readFileSync("prisma/seed.ts", "utf8")).toContain("lifecycleStatus");
  });

  // The known readers of the enum. Moderation no longer names the column: it
  // reads and writes status only through the lifecycle module (C20 ticket 02).
  // The Settlement webhook writes no status at all (C20 ticket 01). The
  // subject guard reads it under the row lock, for the lifecycle commands and
  // the money paths alike.
  it("the enum is read only by the known files", () => {
    const readers = walk("src")
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => readFileSync(file, "utf8").includes("lifecycleStatus"));

    expect(readers.sort()).toEqual(
      [
        "src/app/api/campaigns/route.ts",
        "src/app/api/donations/route.ts",
        "src/lib/campaign-lifecycle.ts",
        // The Campaign page and its API read the column only through
        // effectiveStatus, and send the result as the payload field of the
        // same name (subject-guard-and-suspension-money ticket 04).
        "src/app/api/campaigns/[slug]/route.ts",
        "src/app/campaign/[slug]/page.tsx",
        // These name that payload field, never the column.
        "src/app/campaign/[slug]/donate/page.tsx",
        "src/components/campaign/CampaignDetail.tsx",
        "src/components/campaign/CampaignDetailView.tsx",
        "src/types/campaign.ts",
        // The subject guard reads the column to compute the effective status
        // (subject-guard-and-suspension-money ticket 01).
        "src/lib/subject-guard.ts",
        // The Admin reconcile report reads it, without a lock, only to ask
        // the guard's effectiveStatus/isEscrowReleaseFrozen whether a
        // Suspension keeps a payment in Escrow Hold
        // (subject-guard-and-suspension-money ticket 05).
        "src/app/api/admin/reconcile/route.ts",
        // The legacy status string's former readers (legacy-status-contract
        // ticket 01): the Verifier queue and count filter on SUBMITTED, and
        // "Kampanye Saya" and its API show the effective status.
        "src/app/moderasi/page.tsx",
        "src/app/moderasi/campaigns/page.tsx",
        "src/app/api/user/campaigns/route.ts",
        "src/app/akun/kampanye-saya/page.tsx",
      ].sort()
    );
  });
});
