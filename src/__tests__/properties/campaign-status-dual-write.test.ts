import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The `status` string and the `lifecycleStatus` enum must never diverge:
 * every write that sets one sets the other through `toLifecycleStatus`.
 * This test exists so a new writer cannot reintroduce a silent split.
 *
 * There is no allowlist: today every Campaign write in src/ sets both
 * columns. If a future write legitimately cannot (it must not), add it
 * here as a named literal that a reviewer sees in the diff.
 */
const WRITE = /(prisma|tx)\.campaign\.(create|update|upsert|createMany|updateMany)\b/;

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
      .filter((file) => WRITE.test(readFileSync(file, "utf8")))
      .filter((file) => !readFileSync(file, "utf8").includes("lifecycleStatus"));

    expect(offenders).toEqual([]);
  });

  it("the seed writes lifecycleStatus", () => {
    expect(readFileSync("prisma/seed.ts", "utf8")).toContain("lifecycleStatus");
  });

  // The known readers of the enum. Ticket 03 moved POST /api/donations, the first reader; tickets 04-05 extend this literal further.
  it("only the donations gate has moved to the enum so far", () => {
    const readers = walk("src")
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => readFileSync(file, "utf8").includes("lifecycleStatus"));

    expect(readers.sort()).toEqual(
      [
        "src/app/api/campaigns/[slug]/route.ts",
        "src/app/api/campaigns/route.ts",
        "src/app/api/donations/route.ts",
        "src/app/api/moderasi/campaigns/[id]/route.ts",
        "src/app/api/webhooks/[provider]/route.ts",
        "src/lib/campaign-lifecycle.ts",
      ].sort()
    );
  });
});
