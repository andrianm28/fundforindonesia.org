// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * ci/staging-gate.sh with curl and sleep stubbed: production deploys only a
 * commit staging already runs healthily.
 */
const SCRIPT = resolve("ci/staging-gate.sh");
const SHA = "ab".repeat(20);
let root: string;
let bin: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "staging-gate-"));
  bin = join(root, "bin");
  spawnSync("mkdir", [bin]);
  for (const u of ["jq", "cat"]) {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${u}`], { encoding: "utf8" }).stdout.trim();
    symlinkSync(found, join(bin, u));
  }
  // REVISIONS: space-separated answers of successive /api/version calls (the
  // last repeats); HEALTH: exit code of /api/health.
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/bash
url="\${@: -1}"
case "$url" in
  */api/version)
    n=$(cat "$ROOT/n" 2>/dev/null || echo 0); echo $((n+1)) > "$ROOT/n"
    read -r -a revs <<< "$REVISIONS"; i=$(( n < \${#revs[@]} ? n : \${#revs[@]} - 1 ))
    [ "\${revs[$i]}" = down ] && exit 7
    echo "{\\"revision\\":\\"\${revs[$i]}\\"}" ;;
  */api/health) exit "\${HEALTH:-0}" ;;
esac`,
  );
  chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(join(bin, "sleep"), "#!/bin/bash\nexit 0\n");
  chmodSync(join(bin, "sleep"), 0o755);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function gate(args: string[], env: Record<string, string>) {
  return spawnSync("/bin/bash", [SCRIPT, ...args], {
    env: { PATH: bin, ROOT: root, STAGING_WAIT_SECONDS: "90", STAGING_POLL_SECONDS: "30", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
}

describe("ci/staging-gate.sh", () => {
  it("passes when staging reports the commit and is healthy", () => {
    expect(gate([SHA], { REVISIONS: SHA }).status).toBe(0);
  });

  it("waits for staging to catch up", () => {
    const r = gate([SHA], { REVISIONS: `${"cd".repeat(20)} down ${SHA}` });
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/waiting for/);
  });

  it("refuses when staging never reaches the commit", () => {
    const r = gate([SHA], { REVISIONS: "cd".repeat(20) });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/Refusing to deploy: staging .* does not run/);
  });

  it("refuses when staging runs the commit but is unhealthy", () => {
    expect(gate([SHA], { REVISIONS: SHA, HEALTH: "22" }).status).toBe(1);
  });

  it("refuses a malformed SHA before any request", () => {
    expect(gate(["main"], { REVISIONS: SHA }).status).toBe(2);
  });
});
