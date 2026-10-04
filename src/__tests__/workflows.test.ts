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
 * Guards the production deploy (ticket 07, split into gate/deploy by ticket
 * 24). `gate` has no Environment; `deploy` runs in the `production`
 * Environment, so it starts only once the owner approves it as the
 * environment's required reviewer. The gate's logic is tested in
 * deploy-gate.test.ts; this checks the wiring around it.
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
  /** The lines belonging to job `name` (its own body, not a nested step). */
  const job = (name: string) => block(`  ${name}:`);

  it("is started only by hand (dispatching is the owner's approval)", () => {
    expect(keys("on:")).toEqual(["workflow_dispatch"]);
  });

  it("has gate then deploy, and deploy needs gate", () => {
    expect(keys("jobs:")).toEqual(["gate", "deploy"]);
    expect(job("deploy").map((l) => l.trim())).toContainEqual("needs: gate");
  });

  it("never overlaps or cancels another deploy", () => {
    expect(block("concurrency:").map((l) => l.trim())).toEqual(["group: production", "cancel-in-progress: false"]);
  });

  it("gate has no Environment; deploy runs only in production", () => {
    expect(job("gate")).not.toEqual(expect.arrayContaining([expect.stringMatching(/^\s*environment:/)]));
    expect(job("deploy").map((l) => l.trim())).toContainEqual("environment: production");
  });

  it("gate reads what it checks and writes nothing", () => {
    const start = lines.indexOf("  gate:");
    const permIndex = lines.findIndex((l, i) => i > start && l === "    permissions:");
    expect(
      block(lines[permIndex])
        .map((l) => l.trim().replace(/ *#.*$/, ""))
        .filter((l) => l !== ""),
    ).toEqual(["contents: read", "actions: read", "packages: read"]);
  });

  it("uses the three deploy secrets only in the deploy job, and gate has none", () => {
    const secrets = Array.from(new Set(Array.from(text.matchAll(/secrets\.(\w+)/g), (m) => m[1]))).sort();
    expect(secrets).toEqual(["DEPLOY_HOST", "DEPLOY_KNOWN_HOSTS", "DEPLOY_SSH_KEY"]);
    expect(job("gate").some((l) => /secrets\./.test(l))).toBe(false);
    expect(job("deploy").some((l) => /secrets\./.test(l))).toBe(true);
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

/**
 * Guards the image job's scope (ticket 17). The skip must be a job-level `if`
 * fed by the `scope` job, never a workflow `paths:` filter, so a skipped PR
 * still reports a passing `image` check.
 */
describe("the CD image scope", () => {
  const text = workflows.find((w) => w.file === "cd.yml")?.text ?? "";
  const onBlock = text.match(/^on:\n((?: {2}.*\n|\n)+)/m)?.[1] ?? "";
  const pattern = new RegExp(text.match(/^\s*pattern='([^']+)'/m)?.[1] ?? "(?!)");

  it("has a scope job that the image job needs", () => {
    expect(text).toMatch(/^ {2}scope:$/m);
    expect(text).toMatch(/^ {2}image:\n(?:(?: {4}.*)?\n)*? {4}needs: scope$/m);
  });

  it("never uses pull_request_target or a paths filter on the triggers", () => {
    expect(text).not.toMatch(/pull_request_target/);
    expect(onBlock).not.toBe("");
    expect(onBlock).not.toMatch(/paths(-ignore)?:/);
  });

  it("always builds outside a pull request", () => {
    expect(text).toMatch(/if \[ "\$EVENT" != pull_request \]; then\n\s+echo "build=true" >> "\$GITHUB_OUTPUT"/);
  });

  it("matches image-relevant paths only", () => {
    const hit = ["Dockerfile", "prisma/migrations/x/migration.sql", "public/a.png", "tsconfig.json", "postcss.config.mjs", ".github/workflows/cd.yml"];
    for (const p of hit) expect(pattern.test(p), p).toBe(true);
    for (const p of ["README.md", "docs/x.md", "src/a.ts"]) expect(pattern.test(p), p).toBe(false);
  });
});


/**
 * Ticket 26: the vitest job is sharded three ways. Branch protection and
 * ci/deploy-gate.sh both want a check named exactly `test`, so the shards have
 * other names and an aggregate job called `test` stands in for them.
 */
describe("the CI test shards", () => {
  const lines = (workflows.find((w) => w.file === "ci.yml")?.text ?? "").split("\n");
  /** The lines of job `name` under `jobs:` (two-space-indented key). */
  function job(name: string): string[] {
    const start = lines.indexOf(`  ${name}:`);
    if (start === -1) return [];
    const out: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (/^ {0,2}\S/.test(line)) break;
      out.push(line);
    }
    return out;
  }
  const has = (name: string, re: RegExp) => job(name).some((l) => re.test(l));

  it("run vitest as three shards, each with its own Postgres and no fail-fast", () => {
    expect(has("test-shard", /shard: \[1, 2, 3\]/)).toBe(true);
    expect(has("test-shard", /fail-fast: false/)).toBe(true);
    expect(has("test-shard", /npx vitest run --shard=\$\{\{ matrix\.shard \}\}\/3/)).toBe(true);
    expect(has("test-shard", /^ {6}postgres:/)).toBe(true);
    expect(has("test-shard", /TEST_DATABASE_URL: /)).toBe(true);
    // The shard job must not take the protected name.
    expect(has("test-shard", /^ {4}name: test$/)).toBe(false);
  });

  it("are aggregated by a job named exactly `test` that cannot be skipped into passing", () => {
    expect(has("test", /^ {4}name: test$/)).toBe(true);
    expect(has("test", /needs: \[?test-shard\]?$/)).toBe(true);
    expect(has("test", /if: \$\{\{ always\(\) \}\}/)).toBe(true);
    expect(has("test", /SHARDS_RESULT: \$\{\{ needs\.test-shard\.result \}\}/)).toBe(true);
    expect(has("test", /"\$SHARDS_RESULT" = success/)).toBe(true);
  });

  it("leave the other protected check names alone", () => {
    for (const name of ["build", "migrations", "ratchet", "e2e"]) {
      expect(has(name, new RegExp(`^ {4}name: ${name}$`)), name).toBe(true);
    }
  });
});
