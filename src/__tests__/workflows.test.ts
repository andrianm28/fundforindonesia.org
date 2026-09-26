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
    expect(workflows.map((w) => w.file)).toEqual(expect.arrayContaining(["ci.yml", "cd.yml", "deploy.yml"]));
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

/**
 * Guards the production deploy (ticket 07). The repo is on GitHub Free, so no
 * Environment approval and no branch protection stand in front of it: the
 * workflow's own shape is the whole safety story. The gate's logic is tested
 * in deploy-gate.test.ts; this checks the wiring around it.
 */
describe("the deploy workflow", () => {
  const text = workflows.find((w) => w.file === "deploy.yml")?.text ?? "";
  const lines = text.split("\n");

  /** The lines nested under the first line equal to `header`. */
  function block(header: string): string[] {
    const start = lines.indexOf(header);
    if (start === -1) throw new Error(`"${header.trim()}" not found in deploy.yml`);
    const indent = header.match(/^ */)![0].length;
    const out: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      if (line.match(/^ */)![0].length <= indent) break;
      out.push(line);
    }
    return out;
  }
  const keys = (header: string) => {
    const b = block(header);
    const depth = b[0]?.match(/^ */)![0].length;
    return b.filter((l) => l.match(/^ */)![0].length === depth).map((l) => l.trim().replace(/:.*$/, ""));
  };

  it("is started only by hand (dispatching is the owner's approval)", () => {
    expect(keys("on:")).toEqual(["workflow_dispatch"]);
  });

  it("has exactly one job, deploy", () => {
    expect(keys("jobs:")).toEqual(["deploy"]);
  });

  it("never overlaps or cancels another deploy", () => {
    expect(block("concurrency:").map((l) => l.trim())).toEqual(["group: production", "cancel-in-progress: false"]);
  });

  it("reads what it checks and writes nothing", () => {
    expect(block("    permissions:").map((l) => l.trim().replace(/ *#.*$/, ""))).toEqual([
      "contents: read",
      "actions: read",
      "packages: read",
    ]);
  });

  it("uses only the three deploy secrets, and no Environment", () => {
    const secrets = [...new Set([...text.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]))].sort();
    expect(secrets).toEqual(["DEPLOY_HOST", "DEPLOY_KNOWN_HOSTS", "DEPLOY_SSH_KEY"]);
    expect(text).not.toMatch(/^\s*environment:/m);
  });

  it("interpolates no dispatch input or secret straight into a script", () => {
    // Expressions go through env:, so a crafted input stays data.
    const inRun = lines.filter((l) => /\$\{\{/.test(l) && !/^\s*(?!run:)[\w-]+: \$\{\{.*\}\}\s*$/.test(l));
    expect(inRun).toEqual([]);
  });

  it("runs the gate before anything reaches the host", () => {
    const gate = text.indexOf("ci/deploy-gate.sh");
    const ssh = text.search(/^\s*ssh /m);
    expect(gate).toBeGreaterThan(-1);
    expect(ssh).toBeGreaterThan(gate);
  });

  it("pins the host key and never trusts an unknown one", () => {
    expect(text).not.toMatch(/StrictHostKeyChecking[= ]+(no|accept-new|off)/i);
    for (const option of [
      "StrictHostKeyChecking=yes",
      "UserKnownHostsFile=",
      "GlobalKnownHostsFile=/dev/null",
      "BatchMode=yes",
      "IdentitiesOnly=yes",
    ]) {
      expect(text).toContain(option);
    }
  });

  it("sends the forced command exactly the SHA and the two digests", () => {
    // The destination, then one argument: the three words and nothing else.
    const destination = lines.filter((l) => l.includes('"deploy@$DEPLOY_HOST"'));
    expect(destination).toHaveLength(1);
    expect(destination[0]).toMatch(/ -- "deploy@\$DEPLOY_HOST" "\$SHA \$APP_DIGEST \$MIGRATE_DIGEST"( \|\| rc=\$\?)?$/);
  });

  it("explains every exit code of ops/deploy.sh in the job summary", () => {
    for (const code of ["0", "1", "2", "3", "4", "255"]) {
      expect(text, `exit ${code}`).toMatch(new RegExp(`^\\s*${code}\\) `, "m"));
    }
  });
});

