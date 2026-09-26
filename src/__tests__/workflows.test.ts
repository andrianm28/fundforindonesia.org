// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the GitHub Actions workflows' supply chain (tickets 02 and 05).
 *
 * A tag such as `@v4` can be moved to different code after review, and the
 * image job holds a token that can push production images. So every action is
 * pinned to a full commit SHA, with the version in a comment for humans and
 * Dependabot, and write permissions are granted per job, never workflow-wide.
 */
const dir = resolve(".github/workflows");
const workflows = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(resolve(dir, f), "utf8") }));

describe("GitHub Actions workflows", () => {
  it("include the CI and CD workflows", () => {
    expect(workflows.map((w) => w.file)).toEqual(expect.arrayContaining(["ci.yml", "cd.yml"]));
  });

  it("pin every action to a full commit SHA with a version comment", () => {
    const unpinned = workflows.flatMap(({ file, text }) =>
      text
        .split("\n")
        .filter((l) => /^\s*(- )?uses:/.test(l))
        .filter((l) => !/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(l.trim().replace(/^- /, "")))
        .map((l) => `${file}: ${l.trim()}`),
    );
    expect(unpinned).toEqual([]);
  });

  it("default to read-only contents at the workflow level", () => {
    for (const { file, text } of workflows) {
      expect(text, file).toMatch(/^permissions:\n {2}contents: read\n(?! )/m);
    }
  });
});
