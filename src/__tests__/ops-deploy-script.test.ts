// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Runs the real ops/deploy.sh (.scratch/ci-cd-github-actions, ticket 06) with
 * `docker`, `curl` and `sleep` replaced by stubs, the technique of
 * deploy-script.test.ts. Nothing touches a Docker daemon or the network.
 *
 * PATH is the stub directory alone. Besides the stubs it holds symlinks to the
 * few real utilities the script needs (date, mkdir, ...), and never docker or
 * curl, so a missing stub fails with "command not found" instead of reaching
 * the real binary.
 *
 * The docker stub appends each call to a log, with compose's prefix
 * (`compose --project-directory ... -f ... --env-file ...`) shortened to
 * `compose`, and prefixed with the APP_DIGEST it ran under for `up` calls.
 * It prints a fake dump for pg_dump. `DOCKER_FAIL_ON` (a shell glob over the
 * shortened call) makes matching calls exit 1. The curl stub answers healthy
 * unless the app last brought up runs `UNHEALTHY_DIGEST`.
 */
const SCRIPT = resolve("ops/deploy.sh");
const IMAGE = "ghcr.io/andrianm28/fundforindonesia.org";
const REAL_UTILS = ["date", "mkdir", "mv", "rm", "tee", "flock"];
const SECRET = "s3cret-value-that-must-never-be-logged";

let root: string;
let stubDir: string;
let deployDir: string;
let callLog: string;

const sha = (n: number) => `${n.toString(16).padStart(2, "0").repeat(19)}ef`;
const digest = (n: number, kind: "a" | "m" = "a") =>
  `sha256:${kind === "a" ? "a" : "b"}${n.toString(16).padStart(2, "0").repeat(31)}f`;
/** A release: its commit SHA and the digests of its app and migrate images. */
const release = (n: number) => ({ sha: sha(n), app: digest(n, "a"), migrate: digest(n, "m") });
type Release = ReturnType<typeof release>;

function writeStub(name: string, body: string) {
  const path = join(stubDir, name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ops-deploy-test-"));
  stubDir = join(root, "bin");
  deployDir = join(root, "deploy");
  mkdirSync(stubDir);
  mkdirSync(deployDir);
  callLog = join(root, "docker-calls.log");
  writeFileSync(callLog, "");
  writeFileSync(join(deployDir, ".env"), `DB_PASSWORD=${SECRET}\nNEXTAUTH_SECRET=${SECRET}\n`);
  writeFileSync(join(deployDir, "docker-compose.prod.yml"), readFileSync("docker-compose.prod.yml"));

  for (const util of REAL_UTILS) {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${util}`], { encoding: "utf8" });
    symlinkSync(found.stdout.trim(), join(stubDir, util));
  }
  writeStub(
    "docker",
    `args="$*"
args="\${args/compose --project-directory $DEPLOY_DIR -f $DEPLOY_DIR\\/docker-compose.prod.yml --env-file $DEPLOY_DIR\\/.env/compose}"
case "$args" in
  *" up "*) echo "[app=$APP_DIGEST] $args" >> "$DOCKER_CALL_LOG" ;;
  *) echo "$args" >> "$DOCKER_CALL_LOG" ;;
esac
case "$args" in *" up "*app) echo "$APP_DIGEST" > "$STUB_STATE/running" ;; esac
if [ -n "$DOCKER_FAIL_ON" ]; then case "$args" in $DOCKER_FAIL_ON) exit 1 ;; esac; fi
case "$args" in *pg_dump*) echo "PGDMP fake dump" ;; esac
exit 0`,
  );
  writeStub(
    "curl",
    `running="$(< "$STUB_STATE/running")"
[ -n "$UNHEALTHY_DIGEST" ] && [ "$running" = "$UNHEALTHY_DIGEST" ] && exit 22
exit 0`,
  );
  writeStub("sleep", "exit 0");
  writeFileSync(join(root, "running"), "");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function deploy(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("/bin/bash", [SCRIPT, ...args], {
    env: {
      PATH: stubDir,
      DEPLOY_DIR: deployDir,
      DOCKER_CALL_LOG: callLog,
      STUB_STATE: root,
      ...env,
    } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return { ...result, calls: dockerCalls() };
}

const deployRelease = (r: Release, env: Record<string, string> = {}) =>
  deploy([r.sha, r.app, r.migrate], env);

function dockerCalls(): string[] {
  return readFileSync(callLog, "utf8").split("\n").filter(Boolean);
}

const stateFile = (name: string) => {
  const path = join(deployDir, "state", name);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
};
const backups = () => readdirSync(join(deployDir, "backups")).sort();

describe("ops/deploy.sh", () => {
  it("pulls, backs up, migrates, switches the app, checks health and records the release", () => {
    const r = release(1);
    const { status, calls, stderr } = deployRelease(r);

    expect(status, stderr).toBe(0);
    expect(calls).toEqual([
      `pull ${IMAGE}@${r.app}`,
      `pull ${IMAGE}@${r.migrate}`,
      `tag ${IMAGE}@${r.app} ${IMAGE}:${r.sha}`,
      `tag ${IMAGE}@${r.migrate} ${IMAGE}:${r.sha}-migrate`,
      `[app=${r.app}] compose up -d --wait db`,
      "compose exec -T db pg_dump -U fundindo -d fund_indonesia --format=custom",
      "compose --profile migrate run --rm -T migrate",
      `[app=${r.app}] compose up -d app`,
    ]);
    expect(stateFile("current")).toBe(`${r.sha} ${r.app} ${r.migrate}`);
    expect(backups()).toHaveLength(1);
    expect(readFileSync(join(deployDir, "backups", backups()[0]), "utf8")).toContain("PGDMP");
  });

  describe("rejects anything but a commit SHA and two sha256 digests, before any docker call", () => {
    const r = release(1);
    it.each([
      ["no arguments", []],
      ["a short SHA", [r.sha.slice(0, 7), r.app, r.migrate]],
      ["an uppercase SHA", [r.sha.toUpperCase(), r.app, r.migrate]],
      ["a tag name", ["latest", r.app, r.migrate]],
      ["a digest without its algorithm", [r.sha, r.app.slice(7), r.migrate]],
      ["a short digest", [r.sha, r.app.slice(0, 40), r.migrate]],
      ["a missing migrate digest", [r.sha, r.app]],
      ["an extra argument", [r.sha, r.app, r.migrate, "--force"]],
      ["shell syntax", [`${r.sha};id`, r.app, r.migrate]],
      ["a SHA with a trailing newline", [`${r.sha}\n`, r.app, r.migrate]],
    ])("%s", (_, args) => {
      const { status, calls, stderr } = deploy(args);
      expect(status).toBe(2);
      expect(calls).toEqual([]);
      expect(stderr).toMatch(/usage/i);
    });
  });

  describe("through the SSH forced command (arguments in SSH_ORIGINAL_COMMAND)", () => {
    it("deploys the release named there", () => {
      const r = release(1);
      const { status } = deploy([], { SSH_ORIGINAL_COMMAND: `${r.sha} ${r.app} ${r.migrate}` });
      expect(status).toBe(0);
      expect(stateFile("current")).toBe(`${r.sha} ${r.app} ${r.migrate}`);
    });

    it.each([
      ["a shell command", "rm -rf /"],
      ["a glob", "* * *"],
      ["a release followed by a command", `${release(1).sha} ${release(1).app} ${release(1).migrate} ; id`],
    ])("rejects %s", (_, command) => {
      const { status, calls } = deploy([], { SSH_ORIGINAL_COMMAND: command });
      expect(status).toBe(2);
      expect(calls).toEqual([]);
    });
  });

  it("refuses to run without the production .env in the deploy directory", () => {
    rmSync(join(deployDir, ".env"));
    const { status, calls, stderr } = deployRelease(release(1));
    expect(status).not.toBe(0);
    expect(calls).toEqual([]);
    expect(stderr).toMatch(/\.env/);
  });

  it("records the release it replaced as the previous one", () => {
    const [r1, r2] = [release(1), release(2)];
    deployRelease(r1);
    deployRelease(r2);
    expect(stateFile("current")).toBe(`${r2.sha} ${r2.app} ${r2.migrate}`);
    expect(stateFile("previous")).toBe(`${r1.sha} ${r1.app} ${r1.migrate}`);
  });

  it("redeploying the current release keeps the previous one as the rollback target", () => {
    const [r1, r2] = [release(1), release(2)];
    deployRelease(r1);
    deployRelease(r2);
    deployRelease(r2);
    expect(stateFile("previous")).toBe(`${r1.sha} ${r1.app} ${r1.migrate}`);
  });

  describe("the deploy log", () => {
    const log = () => readFileSync(join(deployDir, "logs", "deploy.log"), "utf8");

    it("appends every run, with its steps and outcome, to logs/deploy.log", () => {
      const [r1, r2] = [release(1), release(2)];
      deployRelease(r1);
      const { stdout } = deployRelease(r2, { UNHEALTHY_DIGEST: r2.app });

      expect(log()).toContain(`Deploying ${r1.sha}`);
      expect(log()).toContain(`Deployed ${r1.sha}`);
      expect(log()).toContain(`Deploying ${r2.sha}`);
      expect(log()).toMatch(/migrat/i);
      expect(log()).toMatch(/rolled back/i);
      // The same lines reach the caller (the deploy job's log).
      expect(stdout).toMatch(/rolled back/i);
    });

    it("logs a failing step's error too", () => {
      deployRelease(release(1), { DOCKER_FAIL_ON: "*migrate run*" });
      expect(log()).toMatch(/fail/i);
    });

    it("never contains the production .env's values", () => {
      const { stdout, stderr } = deployRelease(release(1));
      deployRelease(release(2), { DOCKER_FAIL_ON: "*migrate run*" });
      expect(log()).not.toContain(SECRET);
      expect(stdout + stderr).not.toContain(SECRET);
    });
  });

  it("refuses to start while another deploy holds the lock", () => {
    mkdirSync(join(deployDir, "state"));
    const lock = join(deployDir, "state", "deploy.lock");
    const holder = spawnSync("flock", [lock, "/bin/bash", "-c", `PATH=${stubDir} DEPLOY_DIR=${deployDir} DOCKER_CALL_LOG=${callLog} STUB_STATE=${root} /bin/bash ${SCRIPT} ${release(1).sha} ${release(1).app} ${release(1).migrate}`], {
      encoding: "utf8",
    });
    expect(holder.status).not.toBe(0);
    expect(dockerCalls()).toEqual([]);
    expect(holder.stderr).toMatch(/another deploy/i);
  });

  describe("pruning images", () => {
    const removals = (calls: string[]) => calls.filter((c) => /^(image )?(rm|rmi|prune)\b|image prune/.test(c));
    const removed = (calls: string[], r: Release) => removals(calls).some((c) => c.includes(r.sha));

    it("keeps the images of the last 3 releases and removes the older ones' tags and digests", () => {
      const rs = [1, 2, 3, 4, 5].map(release);
      for (const r of rs) expect(deployRelease(r).status).toBe(0);

      const calls = dockerCalls();
      expect(removed(calls, rs[0])).toBe(true);
      expect(removed(calls, rs[1])).toBe(true);
      for (const r of rs.slice(2)) expect(removed(calls, r), r.sha).toBe(false);
      const rmOfFirst = removals(calls).filter((c) => c.includes(rs[0].sha) || c.includes(rs[0].app));
      expect(rmOfFirst.join("\n")).toContain(`${IMAGE}:${rs[0].sha}-migrate`);
      expect(rmOfFirst.join("\n")).toContain(`${IMAGE}@${rs[0].app}`);
      expect(rmOfFirst.join("\n")).toContain(`${IMAGE}@${rs[0].migrate}`);
    });

    it("only ever removes this repository's images, by name, never with prune or force", () => {
      for (const n of [1, 2, 3, 4, 5]) deployRelease(release(n));
      const rms = removals(dockerCalls());
      expect(rms.length).toBeGreaterThan(0);
      for (const c of rms) {
        expect(c).toMatch(/^image rm /);
        expect(c).not.toMatch(/prune|-f\b|--force/);
        for (const ref of c.replace(/^image rm /, "").split(" ")) expect(ref.startsWith(IMAGE)).toBe(true);
      }
    });

    it("keeps the rollback target even when failed deploys pushed it out of the last 3", () => {
      const [r1, r2, r3, r4, r5] = [1, 2, 3, 4, 5].map(release);
      deployRelease(r1);
      deployRelease(r2);
      deployRelease(r3, { DOCKER_FAIL_ON: "*migrate run*" });
      deployRelease(r4, { DOCKER_FAIL_ON: "*migrate run*" });
      expect(deployRelease(r5).status).toBe(0);

      expect(stateFile("previous")).toBe(`${r2.sha} ${r2.app} ${r2.migrate}`);
      const calls = dockerCalls();
      expect(removed(calls, r1)).toBe(true);
      expect(removed(calls, r2)).toBe(false);
    });

    it("a failed deploy prunes nothing", () => {
      for (const n of [1, 2, 3]) deployRelease(release(n));
      writeFileSync(callLog, "");
      deployRelease(release(4), { UNHEALTHY_DIGEST: release(4).app });
      expect(removals(dockerCalls())).toEqual([]);
    });
  });

  describe("when the new app never answers /api/health", () => {
    it("recreates the app on the previous release, keeps it recorded, and fails", () => {
      const r1 = release(1);
      const r2 = release(2);
      expect(deployRelease(r1).status).toBe(0);
      writeFileSync(callLog, "");

      const { status, calls, stdout } = deployRelease(r2, { UNHEALTHY_DIGEST: r2.app });

      expect(status).toBe(3);
      expect(calls.filter((c) => c.endsWith("compose up -d app"))).toEqual([
        `[app=${r2.app}] compose up -d app`,
        `[app=${r1.app}] compose up -d app`,
      ]);
      expect(stdout).toMatch(/rolled back/i);
      expect(stateFile("current")).toBe(`${r1.sha} ${r1.app} ${r1.migrate}`);
    });

    it("says so, with its own exit code, when the previous release is unhealthy too", () => {
      const [r1, r2] = [release(1), release(2)];
      deployRelease(r1);
      writeStub("curl", "exit 22"); // the database is down, say: nothing is healthy
      const { status, calls, stdout } = deployRelease(r2);

      expect(status).toBe(4);
      expect(calls.at(-1)).toBe(`[app=${r1.app}] compose up -d app`);
      expect(stdout).toMatch(/not healthy either/i);
      expect(stateFile("current")).toBe(`${r1.sha} ${r1.app} ${r1.migrate}`);
    });

    it("treats an app container that fails to start like an unhealthy one, and rolls back", () => {
      const [r1, r2] = [release(1), release(2)];
      deployRelease(r1);
      writeFileSync(callLog, "");
      const { status, calls } = deployRelease(r2, { DOCKER_FAIL_ON: "compose up -d app" });
      // The stub fails every `up -d app`, the rollback's too.
      expect(status).toBe(4);
      expect(calls.filter((c) => c.endsWith("compose up -d app"))).toHaveLength(2);
    });

    it("on the first deploy, with nothing to roll back to, fails without a rollback", () => {
      const r1 = release(1);
      const { status, calls, stdout } = deployRelease(r1, { UNHEALTHY_DIGEST: r1.app });

      expect(status).toBe(4);
      expect(calls.filter((c) => c.endsWith("compose up -d app"))).toHaveLength(1);
      expect(stdout).toMatch(/no previous release/i);
      expect(stateFile("current")).toBe("");
    });
  });

  it.each([
    ["the migration", "*migrate run*"],
    ["the backup", "*pg_dump*"],
    ["pulling the image", "pull *"],
  ])("when %s fails, stops before touching the running app", (_, failOn) => {
    const r1 = release(1);
    const r2 = release(2);
    expect(deployRelease(r1).status).toBe(0);
    writeFileSync(callLog, "");

    const { status, calls } = deployRelease(r2, { DOCKER_FAIL_ON: failOn });

    expect(status).toBe(1);
    expect(calls.some((c) => c.endsWith("compose up -d app"))).toBe(false);
    expect(stateFile("current")).toBe(`${r1.sha} ${r1.app} ${r1.migrate}`);
  });

  it("keeps the newest 7 backups", () => {
    const dir = join(deployDir, "backups");
    mkdirSync(dir);
    // Eight older dumps, named as the script names them (UTC timestamp first).
    const old = Array.from({ length: 8 }, (_, i) => `20260101T00000${i}Z-${sha(i).slice(0, 12)}.dump`);
    for (const f of old) writeFileSync(join(dir, f), "PGDMP old");
    writeFileSync(join(dir, "notes.txt"), "not a dump, left alone");

    expect(deployRelease(release(9)).status).toBe(0);

    const dumps = backups().filter((f) => f.endsWith(".dump"));
    expect(dumps).toHaveLength(7);
    expect(dumps.slice(0, 6)).toEqual(old.slice(2));
    expect(dumps[6]).toMatch(new RegExp(`^\\d{8}T\\d{6}Z-${sha(9).slice(0, 12)}\\.dump$`));
    expect(backups()).toContain("notes.txt");
  });

  it("does not keep a failed backup as if it were one", () => {
    const { status } = deployRelease(release(1), { DOCKER_FAIL_ON: "*pg_dump*" });
    expect(status).not.toBe(0);
    expect(backups().filter((f) => f.endsWith(".dump"))).toEqual([]);
  });

  it("waits for a slow app to come up", () => {
    // Unhealthy for the first 5 polls, then healthy.
    writeFileSync(join(root, "polls"), "0");
    writeStub(
      "curl",
      `n=$(( $(< "$STUB_STATE/polls") + 1 )); echo $n > "$STUB_STATE/polls"
[ $n -gt 5 ]`,
    );
    const r = release(1);
    expect(deployRelease(r).status).toBe(0);
    expect(stateFile("current")).toBe(`${r.sha} ${r.app} ${r.migrate}`);
  });
});
