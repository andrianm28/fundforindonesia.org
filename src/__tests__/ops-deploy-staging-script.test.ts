// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Runs the real ops/deploy-staging.sh with `docker`, `curl` and `sleep`
 * stubbed (the technique of ops-deploy-script.test.ts): nothing touches a
 * Docker daemon or the network. The docker stub answers `image inspect` with
 * the digest and revision label of the release named by STUB_SHA/STUB_APP/
 * STUB_MIGRATE, logs every call with compose's prefix shortened to `compose`,
 * and remembers which APP_DIGEST was brought up; curl answers healthy unless
 * that digest is UNHEALTHY_DIGEST.
 */
const SCRIPT = resolve("ops/deploy-staging.sh");
const IMAGE = "ghcr.io/andrianm28/fundforindonesia.org";
const REAL_UTILS = ["date", "mkdir", "mv", "rm", "tee", "flock", "sed", "head", "cut", "grep", "cat"];
const SECRET = "s3cret-value-that-must-never-be-logged";

const sha = (n: number) => `${n.toString(16).padStart(2, "0").repeat(19)}ef`;
const digest = (n: number, k: "a" | "b") => `sha256:${k}${n.toString(16).padStart(2, "0").repeat(31)}f`;
const release = (n: number) => ({ sha: sha(n), app: digest(n, "a"), migrate: digest(n, "b") });
type Release = ReturnType<typeof release>;

let root: string;
let stubDir: string;
let deployDir: string;
let callLog: string;

function writeStub(name: string, body: string) {
  const path = join(stubDir, name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ops-deploy-staging-test-"));
  stubDir = join(root, "bin");
  deployDir = join(root, "deploy");
  mkdirSync(stubDir);
  mkdirSync(deployDir);
  callLog = join(root, "docker-calls.log");
  writeFileSync(callLog, "");
  writeFileSync(join(root, "running"), "");
  writeFileSync(join(deployDir, ".env"), `DB_PASSWORD=${SECRET}\n`);
  writeFileSync(join(deployDir, "docker-compose.staging.yml"), readFileSync("docker-compose.staging.yml"));
  for (const util of REAL_UTILS) {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${util}`], { encoding: "utf8" });
    symlinkSync(found.stdout.trim(), join(stubDir, util));
  }
  writeStub(
    "docker",
    `args="$*"
args="\${args/compose --project-directory $DEPLOY_DIR -f $DEPLOY_DIR\\/docker-compose.staging.yml --env-file $DEPLOY_DIR\\/.env/compose}"
case "$args" in
  "image inspect --format {{range .RepoDigests}}"*migrate) echo "${IMAGE}@$STUB_MIGRATE"; exit 0 ;;
  "image inspect --format {{range .RepoDigests}}"*) echo "${IMAGE}@$STUB_APP"; exit 0 ;;
  "image inspect --format {{index .Config.Labels"*) echo "$STUB_SHA"; exit 0 ;;
  "image ls"*) exit 0 ;;
  *" up "*) echo "[app=$APP_DIGEST] $args" >> "$DOCKER_CALL_LOG" ;;
  *) echo "$args" >> "$DOCKER_CALL_LOG" ;;
esac
case "$args" in *" up -d app") echo "$APP_DIGEST" > "$STUB_STATE/running" ;; esac
if [ -n "$DOCKER_FAIL_ON" ]; then case "$args" in $DOCKER_FAIL_ON) exit 1 ;; esac; fi
case "$args" in *pg_dump*) echo "PGDMP fake dump" ;; esac
exit 0`,
  );
  writeStub(
    "curl",
    `running="$(< "$STUB_STATE/running")"
[ -n "$UNHEALTHY_DIGEST" ] && [ "$running" = "$UNHEALTHY_DIGEST" ] && exit 22
[ -z "$running" ] && exit 7
exit 0`,
  );
  writeStub("sleep", "exit 0");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function deploy(r: Release, args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync("/bin/bash", [SCRIPT, ...args], {
    env: {
      PATH: stubDir,
      DEPLOY_DIR: deployDir,
      DOCKER_CALL_LOG: callLog,
      STUB_STATE: root,
      STUB_SHA: r.sha,
      STUB_APP: r.app,
      STUB_MIGRATE: r.migrate,
      ...env,
    } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  const calls = readFileSync(callLog, "utf8").split("\n").filter(Boolean);
  writeFileSync(callLog, "");
  return { ...result, calls };
}

const stateFile = (name: string) => {
  const path = join(deployDir, "state", name);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
};

describe("ops/deploy-staging.sh", () => {
  it("pulls :staging, backs up, migrates with the same commit's migrate image, switches and records", () => {
    const r = release(1);
    const { status, calls, stderr, stdout } = deploy(r);

    expect(status, stderr).toBe(0);
    expect(calls).toEqual([
      `pull -q ${IMAGE}:staging`,
      `tag ${IMAGE}:staging ${IMAGE}:${r.sha}-staging`,
      `pull -q ${IMAGE}:${r.sha}-migrate`,
      `[app=${r.app}] compose up -d --wait db`,
      'compose exec -T db sh -c pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',
      "compose --profile migrate run --rm -T migrate",
      `[app=${r.app}] compose up -d app`,
    ]);
    expect(stateFile("current")).toBe(`${r.sha} ${r.app} ${r.migrate}`);
    expect(stdout + stderr).not.toContain(SECRET);
  });

  it("does nothing when the running release is already :staging and healthy", () => {
    const r = release(1);
    expect(deploy(r).status).toBe(0);
    const { status, calls } = deploy(r);
    expect(status).toBe(0);
    expect(calls).toEqual([`pull -q ${IMAGE}:staging`, `tag ${IMAGE}:staging ${IMAGE}:${r.sha}-staging`]);
  });

  it("deploys a pinned commit's staging image", () => {
    const r = release(2);
    const { status, calls } = deploy(r, [r.sha]);
    expect(status).toBe(0);
    expect(calls[0]).toBe(`pull -q ${IMAGE}:${r.sha}-staging`);
  });

  it("goes back to the previous release when the new one never gets healthy", () => {
    const a = release(1);
    const b = release(2);
    expect(deploy(a).status).toBe(0);
    const { status, calls } = deploy(b, [], { UNHEALTHY_DIGEST: b.app });
    expect(status).toBe(3);
    expect(calls.at(-1)).toBe(`[app=${a.app}] compose up -d app`);
    expect(stateFile("current")).toBe(`${a.sha} ${a.app} ${a.migrate}`);
  });

  it("stops before the app is touched when the migrations fail", () => {
    const r = release(1);
    const { status, calls } = deploy(r, [], { DOCKER_FAIL_ON: "*migrate run*" });
    expect(status).not.toBe(0);
    expect(calls.some((c) => c.endsWith("up -d app"))).toBe(false);
    expect(stateFile("current")).toBe("");
  });

  it.each([["a short sha", ["abc1234"]], ["two arguments", [sha(1), sha(2)]], ["shell syntax", [`${sha(1)};id`]]])(
    "refuses %s before any docker call",
    (_, args) => {
      const { status, calls } = deploy(release(1), args);
      expect(status).toBe(2);
      expect(calls).toEqual([]);
    },
  );

  it("never names production's compose file, project, port or volumes", () => {
    const text = readFileSync(SCRIPT, "utf8");
    expect(text).not.toMatch(/docker-compose\.prod\.yml|fundforindonesia-prod|8093|kibi-clone/);
  });
});
