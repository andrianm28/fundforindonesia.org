import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Campaign.isUrgent drives the homepage "mendesak" rail and the `?urgent`
 * filter. Only an Admin decides it, and it must drop whenever a Campaign
 * leaves Active, so it has exactly one writer: the lifecycle module
 * (setUrgent and the leave-Active side effects). A route that wrote it
 * directly would skip the Admin rule, the audit log, or both.
 *
 * Checked per Campaign write call, not per file: several files both write a
 * Campaign and merely READ isUrgent (for example to answer a GET). Like the
 * dual-write guard, it recognises writes through `prisma.` or `tx.` only;
 * a client under another name, or a nested write from another model, is
 * outside what it can see.
 *
 * The allowlist is a literal. Adding a file to it is a deliberate decision
 * that a reviewer sees in the diff.
 */
const ALLOWED_WRITERS = ["src/lib/campaign-lifecycle.ts"];

const WRITE = /(prisma|tx)\.campaign\.(create|update|upsert|createMany|updateMany)\s*\(/g;

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

/** The full argument text of every Campaign write call, parentheses balanced. */
function campaignWriteCalls(source: string): string[] {
  const calls: string[] = [];
  for (const match of Array.from(source.matchAll(WRITE))) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++;
      if (source[end] === ")" && --depth === 0) break;
    }
    calls.push(source.slice(open, end + 1));
  }
  return calls;
}

const appFiles = () =>
  walk("src")
    .filter((file) => !file.startsWith("src/generated/"))
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));

describe("Campaign.isUrgent has exactly one writer", () => {
  it("no Campaign write outside the lifecycle module touches isUrgent", () => {
    const writers = appFiles().filter((file) =>
      campaignWriteCalls(readFileSync(file, "utf8")).some((call) => /\bisUrgent\b/.test(call))
    );

    expect(writers).toEqual(ALLOWED_WRITERS);
  });

  // Guards the guard: if the call extraction silently stopped finding
  // writes, the test above would pass vacuously.
  it("the extraction sees the lifecycle module's Urgent writes and other files' Campaign writes", () => {
    const lifecycle = campaignWriteCalls(readFileSync("src/lib/campaign-lifecycle.ts", "utf8"));
    expect(lifecycle.filter((call) => /data:\s*\{\s*isUrgent:/.test(call)).length).toBeGreaterThanOrEqual(2);

    const creation = campaignWriteCalls(readFileSync("src/app/api/campaigns/route.ts", "utf8"));
    expect(creation.length).toBeGreaterThan(0);
  });
});
