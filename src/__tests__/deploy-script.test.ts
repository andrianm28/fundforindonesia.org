// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Runs the real deploy.sh with `docker` and `sleep` replaced by stubs on PATH,
 * so nothing touches a Docker daemon. The docker stub records each invocation
 * as one line in a log, which is what these tests observe.
 */
const DEPLOY_SH = resolve(__dirname, "../../deploy.sh");

let stubDir: string;
let callLog: string;

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "deploy-sh-test-"));
  callLog = join(stubDir, "docker-calls.log");
  writeFileSync(callLog, "");
  const docker = join(stubDir, "docker");
  writeFileSync(docker, `#!/bin/sh\necho "$*" >> "${callLog}"\n`);
  chmodSync(docker, 0o755);
  const sleep = join(stubDir, "sleep");
  writeFileSync(sleep, "#!/bin/sh\nexit 0\n");
  chmodSync(sleep, 0o755);
});

afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

function deploy(env: Record<string, string> = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.SEED;
  const result = spawnSync("bash", [DEPLOY_SH], {
    env: { ...baseEnv, ...env, PATH: `${stubDir}:${process.env.PATH}` },
    encoding: "utf8",
  });
  return { ...result, calls: dockerCalls() };
}

function dockerCalls(): string[] {
  return readFileSync(callLog, "utf8").split("\n").filter(Boolean);
}

describe("deploy.sh", () => {
  it("a default deploy never runs the seed and starts the app", () => {
    const { status, calls } = deploy();
    expect(status).toBe(0);
    expect(calls.some((c) => /\bseed\b/.test(c))).toBe(false);
    expect(calls).toEqual([
      "compose build app",
      "compose up -d db",
      "compose run --rm migrate",
      "compose up -d app",
    ]);
  });

  it("SEED=1 seeds after migrations and before the app, and says so", () => {
    const { status, calls, stdout } = deploy({ SEED: "1" });
    expect(status).toBe(0);
    expect(calls).toEqual([
      "compose build app",
      "compose up -d db",
      "compose run --rm migrate",
      "compose run --rm seed",
      "compose up -d app",
    ]);
    expect(stdout).toMatch(/SEED=1/);
  });

  it.each(["0", "", "true", "yes"])("SEED=%j does not opt in", (value) => {
    const { status, calls } = deploy({ SEED: value });
    expect(status).toBe(0);
    expect(calls).not.toContain("compose run --rm seed");
    expect(calls.at(-1)).toBe("compose up -d app");
  });

  describe("against a database that already has data", () => {
    // The real seed refuses a non-empty database and exits non-zero.
    beforeEach(() => {
      writeFileSync(
        join(stubDir, "docker"),
        `#!/bin/sh\necho "$*" >> "${callLog}"\n[ "$*" = "compose run --rm seed" ] && exit 1\nexit 0\n`,
      );
    });

    it("two default deploys in a row both start the app", () => {
      const first = deploy();
      const second = deploy();
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(second.calls.filter((c) => c === "compose up -d app")).toHaveLength(2);
      expect(second.calls).not.toContain("compose run --rm seed");
    });

    it("SEED=1 stops at the seed's refusal instead of carrying on", () => {
      const { status, calls } = deploy({ SEED: "1" });
      expect(status).not.toBe(0);
      expect(calls.at(-1)).toBe("compose run --rm seed");
    });
  });
});

describe("docker-compose.yml seed service", () => {
  it("still exists but sits behind a profile, so `docker compose up` never starts it", () => {
    const compose = readFileSync(resolve(__dirname, "../../docker-compose.yml"), "utf8");
    const seedBlock = compose.match(/^ {2}seed:\n((?: {4}.*\n| *\n)*)/m);
    expect(seedBlock).not.toBeNull();
    expect(seedBlock![1]).toMatch(/^ {4}profiles:\n {6}- setup$/m);
  });
});
