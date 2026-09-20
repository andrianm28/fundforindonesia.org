import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Campaign.collectedAmount is the headline "dana terkumpul" figure. It is
 * owned by exactly one writer: the settled-payment webhook, which posts the
 * matching ledger entries in the same transaction.
 *
 * The wallet used to be a second writer -- POST /api/balance/donate
 * incremented it with no Payment and no ledger entry -- so the figure could
 * drift away from the ledger with nothing to reconcile it against. This test
 * exists so that path cannot come back unnoticed.
 *
 * The allowlist is a literal. Adding a file to it is a deliberate decision
 * that a reviewer sees in the diff.
 */
const ALLOWED_WRITERS = ["src/app/api/webhooks/[provider]/route.ts"];

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

describe("Campaign.collectedAmount has exactly one writer", () => {
  it("no route outside the allowlist writes collectedAmount", () => {
    const offenders = walk("src/app/api")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          source.includes("collectedAmount:") &&
          (source.includes("increment") || source.includes("decrement"))
        );
      })
      .filter((file) => !ALLOWED_WRITERS.includes(file));

    expect(offenders).toEqual([]);
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
