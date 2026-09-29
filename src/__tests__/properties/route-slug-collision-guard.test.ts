import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Ticket 32. Next.js refuses two differently named dynamic segments at the
 * same route position ("You cannot use different slug names for the same
 * dynamic path"), and the dev server never starts. That failure used to
 * surface only in e2e/image as a webServer timeout (PR 137: `[id]` beside
 * `[requestId]`). This guard walks the route tree in the fast `test` job and
 * names both directories.
 */

interface SlugCollision {
  parent: string;
  a: string;
  b: string;
}

// `[id]`, `[...x]` and `[[...x]]` are dynamic; anything else is static.
const isDynamic = (name: string) => /^\[.+\]$/.test(name);

function findSlugCollisions(root: string): SlugCollision[] {
  const found: SlugCollision[] = [];
  const walk = (dir: string) => {
    const subdirs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const dynamic = subdirs.filter(isDynamic);
    // Any two dynamic siblings collide: identical names cannot coexist on
    // disk, so two entries here always means two different slug names.
    for (let i = 1; i < dynamic.length; i++) {
      found.push({ parent: dir, a: dynamic[0], b: dynamic[i] });
    }
    for (const name of subdirs) walk(join(dir, name));
  };
  walk(root);
  return found;
}

describe("findSlugCollisions (the guard itself)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "route-slug-guard-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const dirs = (...paths: string[]) =>
    paths.forEach((p) => mkdirSync(join(root, p), { recursive: true }));

  it("fails on [id] beside [requestId], naming both directories", () => {
    dirs("api/bank-accounts/[id]", "api/bank-accounts/[requestId]");
    const found = findSlugCollisions(root);
    expect(found).toHaveLength(1);
    expect([found[0].a, found[0].b].sort()).toEqual(["[id]", "[requestId]"]);
    expect(found[0].parent).toBe(join(root, "api/bank-accounts"));
  });

  it("passes on [id] beside a static segment", () => {
    dirs("api/bank-accounts/[id]", "api/bank-accounts/revocations");
    expect(findSlugCollisions(root)).toEqual([]);
  });

  it("passes when the same name repeats in different parents", () => {
    dirs("a/[id]", "b/[requestId]");
    expect(findSlugCollisions(root)).toEqual([]);
  });

  it("fails on a catch-all beside a plain dynamic sibling", () => {
    dirs("x/[...rest]", "x/[y]");
    expect(findSlugCollisions(root)).toHaveLength(1);
  });

  it("fails on an optional catch-all beside a plain dynamic sibling", () => {
    dirs("x/[[...rest]]", "x/[y]");
    expect(findSlugCollisions(root)).toHaveLength(1);
  });

  it("descends into nested dynamic segments", () => {
    dirs("a/[id]/b/[p]", "a/[id]/b/[q]");
    expect(findSlugCollisions(root)).toHaveLength(1);
  });
});

describe("src/app route tree", () => {
  it("has no two dynamic siblings with different slug names", () => {
    expect(readdirSync("src/app").length).toBeGreaterThan(0);
    const msg = findSlugCollisions("src/app")
      .map((c) => `${join(c.parent, c.a)} and ${join(c.parent, c.b)}`)
      .join("\n");
    expect(msg).toBe("");
  });
});
