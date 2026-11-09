// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** ci/post-deploy-smoke.sh with curl and sleep stubbed. */
const SCRIPT = resolve("ci/post-deploy-smoke.sh");
const SHA = "ab".repeat(20);
let root: string;
let bin: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "smoke-"));
  bin = join(root, "bin");
  spawnSync("mkdir", [bin]);
  for (const u of ["jq", "cat"]) {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${u}`], { encoding: "utf8" }).stdout.trim();
    symlinkSync(found, join(bin, u));
  }
  // PAGE_CODES: space-separated status codes of successive page requests (the
  // last repeats); REVISION: what /api/version reports, or empty for a 404.
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/bash
url="\${@: -1}"
case "$url" in
  */api/version)
    [ -n "$REVISION" ] || exit 22
    echo "{\\"revision\\":\\"$REVISION\\"}" ;;
  *)
    echo "$url" >> "$ROOT/urls"
    n=$(cat "$ROOT/n" 2>/dev/null || echo 0); echo $((n+1)) > "$ROOT/n"
    read -r -a codes <<< "\${PAGE_CODES:-200}"; i=$(( n < \${#codes[@]} ? n : \${#codes[@]} - 1 ))
    printf '%s' "\${codes[$i]}" ;;
esac`,
  );
  chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(join(bin, "sleep"), "#!/bin/bash\nexit 0\n");
  chmodSync(join(bin, "sleep"), 0o755);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function smoke(args: string[], env: Record<string, string>) {
  return spawnSync("/bin/bash", [SCRIPT, ...args], {
    env: { PATH: bin, ROOT: root, ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
}

describe("ci/post-deploy-smoke.sh", () => {
  it("passes when pages answer 200 and production reports the commit", () => {
    const r = smoke([SHA], { REVISION: SHA, PUBLIC_URL: "https://example.test/" });
    expect(r.status, r.stdout).toBe(0);
    expect(spawnSync("cat", [join(root, "urls")], { encoding: "utf8" }).stdout).toBe(
      "https://example.test/\nhttps://example.test/explore/all\n",
    );
  });

  it("retries a page that is not ready yet", () => {
    expect(smoke([SHA], { REVISION: SHA, PAGE_CODES: "502 200" }).status).toBe(0);
  });

  it("fails when a page keeps failing", () => {
    const r = smoke([SHA], { REVISION: SHA, PAGE_CODES: "500" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("::error::");
  });

  it("fails when production reports another commit", () => {
    const r = smoke([SHA], { REVISION: "cd".repeat(20) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("not the deployed");
  });

  it("only warns when the release has no /api/version (a rollback)", () => {
    const r = smoke([SHA], { REVISION: "" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::warning::");
  });

  it("refuses a malformed sha", () => {
    expect(smoke(["main"], { REVISION: SHA }).status).toBe(2);
  });
});
