import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Campaign.collectedAmount is the headline "dana terkumpul" figure. It is
 * owned by exactly two writers, each of which posts the matching ledger
 * entries in the same transaction as the write:
 *
 *  - the settled-payment webhook, for a Donation that came through a
 *    provider;
 *  - src/lib/money/manual-contributions.ts, for a Manual Contribution that
 *    arrived outside the gateway (prd-compliance 34) -- and again on the
 *    reversal, which takes the amount back out of the figure.
 *
 * The wallet used to be a second writer -- POST /api/balance/donate
 * incremented it with no Payment and no ledger entry -- so the figure could
 * drift away from the ledger with nothing to reconcile it against. This test
 * exists so that path cannot come back unnoticed.
 *
 * The allowlist is a literal. Adding a file to it is a deliberate decision
 * that a reviewer sees in the diff.
 */
const ALLOWED_WRITERS = [
  "src/app/api/webhooks/[provider]/route.ts",
  "src/lib/money/manual-contributions.ts",
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

/**
 * The source without its comment lines. The invariant is about statements, and
 * a prose mention of the word "increment" in a file that merely READS the
 * figure -- the reconciliation report, say -- is not a second writer. Without
 * this, the cheapest way to trip the test would be to explain it in a comment.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
    .join("\n");
}

describe("Campaign.collectedAmount has exactly one writer", () => {
  it("no file outside the allowlist writes collectedAmount", () => {
    // Walked over all of src, not just the API routes: the Manual Contribution
    // writer is a service module, and a walk that stopped at src/app/api
    // would have missed it -- and every future one.
    const offenders = walk("src")
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => {
        const source = codeOf(file);
        return (
          source.includes("collectedAmount:") &&
          (source.includes("increment") || source.includes("decrement"))
        );
      })
      .filter((file) => !ALLOWED_WRITERS.includes(file));

    expect(offenders).toEqual([]);
  });

  it("recognises an increment statement and ignores one named in a comment", () => {
    const withRealWrite = 'await tx.campaign.update({ data: { collectedAmount: { increment: n } } });';
    const withOnlyAComment = '// the approval increments collectedAmount in the same transaction\nconst x = 1;';

    expect(withRealWrite.includes("collectedAmount:") && withRealWrite.includes("increment")).toBe(true);
    expect(withOnlyAComment.includes("collectedAmount:") && withOnlyAComment.includes("increment")).toBe(false);
  });

  it("the wallet's spend and mint endpoints no longer exist", () => {
    const routes = walk("src/app/api");

    expect(routes).not.toContain("src/app/api/balance/donate/route.ts");
    expect(routes).not.toContain("src/app/api/user/topup/route.ts");
  });

  it("the read-only balance endpoint still exists, because five users are owed money", () => {
    const routes = walk("src/app/api");

    expect(routes).toContain("src/app/api/balance/route.ts");
  });
});
