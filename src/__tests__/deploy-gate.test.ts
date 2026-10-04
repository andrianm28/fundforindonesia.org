// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Runs the real ci/deploy-gate.sh (.scratch/ci-cd-github-actions, ticket 07),
 * the deploy job's first step, with `gh` and `curl` replaced by stubs, the
 * technique of ops-deploy-script.test.ts. Nothing reaches GitHub or GHCR.
 *
 * The `gh` stub serves `gh api <path>` from JSON fixtures keyed by the path
 * (query string included) and fails like a 404 for any other path. The `curl`
 * stub is a tiny GHCR: it hands out a pull token and serves manifests and
 * blobs from a directory. The images are built here the way buildx pushes
 * them with `provenance: mode=max` (checked against a real GHCR image on
 * 2026-09-26): an OCI index holding the image manifest and an attestation
 * manifest, whose one layer is the SLSA v1 provenance.
 */
const SCRIPT = resolve("ci/deploy-gate.sh");
const REPO = "andrianm28/fundforindonesia.org";
const REAL_UTILS = ["jq", "sha256sum", "mktemp", "rm", "cat", "cut", "tr", "grep"];

const SHA = "3f2c".repeat(10);
const MAIN_HEAD = "9a1b".repeat(10);
const CI_RUN = 111;
const BUILD_RUN = 777;

let root: string;
let stubDir: string;
let fixtures: string;
let registry: string;
let outputFile: string;

const sha256 = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const key = (s: string) => s.replace(/[^A-Za-z0-9]/g, "_");

function writeStub(name: string, body: string) {
  const path = join(stubDir, name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}

/** What `gh api <path>` prints. */
function gh(path: string, body: unknown) {
  writeFileSync(join(fixtures, key(path)), JSON.stringify(body));
}

function manifest(ref: string, body: string) {
  writeFileSync(join(registry, "manifests", key(ref)), body);
}

function blob(digest: string, body: string) {
  writeFileSync(join(registry, "blobs", key(digest)), body);
}

type ImageOptions = {
  revision?: string;
  source?: string;
  target?: string;
  builderId?: string;
  /** Serve a provenance blob whose bytes do not match its digest. */
  tamperProvenance?: boolean;
  /** Leave the attestation manifest out of the index. */
  noAttestation?: boolean;
  /** The image manifest the provenance claims to describe. */
  subjectDigest?: string;
};

/**
 * Publishes one image under `tag` in the fake GHCR and returns the digest the
 * gate must report: the index's, which is what build-push-action outputs and
 * what ops/deploy.sh pulls.
 */
function publish(tag: string, target: "runner" | "migrate", o: ImageOptions = {}) {
  const imageManifest = sha256(`image manifest of ${tag}`);
  const provenance = JSON.stringify({
    _type: "https://in-toto.io/Statement/v0.1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name: `pkg:docker/ghcr.io/${REPO}@${tag}`, digest: { sha256: (o.subjectDigest ?? imageManifest).slice(7) } }],
    predicate: {
      buildDefinition: { externalParameters: { request: { args: { target: o.target ?? target } } } },
      runDetails: {
        builder: { id: o.builderId ?? `https://github.com/${REPO}/actions/runs/${BUILD_RUN}/attempts/1` },
        metadata: {
          buildkit_metadata: {
            vcs: { revision: o.revision ?? SHA, source: o.source ?? `https://github.com/${REPO}` },
          },
        },
      },
    },
  });
  const provenanceDigest = sha256(provenance);
  blob(provenanceDigest, o.tamperProvenance ? provenance.replace(SHA, MAIN_HEAD) : provenance);
  const attestation = JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    artifactType: "application/vnd.docker.attestation.manifest.v1+json",
    layers: [
      {
        mediaType: "application/vnd.in-toto+json",
        digest: provenanceDigest,
        annotations: { "in-toto.io/predicate-type": "https://slsa.dev/provenance/v1" },
      },
    ],
  });
  const attestationDigest = sha256(attestation);
  manifest(attestationDigest, attestation);
  const manifests: unknown[] = [
    {
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: imageManifest,
      platform: { architecture: "amd64", os: "linux" },
    },
  ];
  if (!o.noAttestation) {
    manifests.push({
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: attestationDigest,
      annotations: {
        "vnd.docker.reference.digest": imageManifest,
        "vnd.docker.reference.type": "attestation-manifest",
      },
      platform: { architecture: "unknown", os: "unknown" },
    });
  }
  const index = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests });
  manifest(tag, index);
  return sha256(index);
}

/** A commit on main whose CI passed and whose images cd.yml pushed. */
function releasable(sha = SHA) {
  gh(`repos/${REPO}/compare/main...${sha}`, { status: sha === MAIN_HEAD ? "identical" : "behind" });
  gh(`repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&event=push&status=success`, {
    total_count: 1,
    workflow_runs: [
      { id: CI_RUN, head_sha: sha, head_branch: "main", event: "push", status: "completed", conclusion: "success" },
    ],
  });
  gh(`repos/${REPO}/actions/runs/${CI_RUN}/jobs`, {
    total_count: 5,
    jobs: ["test", "ratchet", "migrations", "build"].map((name) => ({ name, conclusion: "success" })),
  });
  gh(`repos/${REPO}/actions/runs/${BUILD_RUN}`, {
    id: BUILD_RUN,
    path: ".github/workflows/cd.yml",
    head_branch: "main",
    event: "workflow_run",
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deploy-gate-test-"));
  stubDir = join(root, "bin");
  fixtures = join(root, "gh");
  registry = join(root, "registry");
  outputFile = join(root, "github-output");
  for (const d of [stubDir, fixtures, join(registry, "manifests"), join(registry, "blobs")]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(outputFile, "");
  for (const util of REAL_UTILS) {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${util}`], { encoding: "utf8" });
    symlinkSync(found.stdout.trim(), join(stubDir, util));
  }
  writeStub(
    "gh",
    `[ "$1" = api ] && [ $# -eq 2 ] || { echo "gh stub: unexpected call: $*" >&2; exit 2; }
f="$GH_FIXTURES/$(printf '%s' "$2" | tr -c 'A-Za-z0-9' '_')"
[ -f "$f" ] || { echo '{"message":"Not Found","status":"404"}'; echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
cat "$f"`,
  );
  // Handles the two shapes the gate uses: the token exchange (credentials on
  // stdin via -K -), and a registry GET written to -o <file>.
  writeStub(
    "curl",
    `out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -K) [ "$2" = - ] && cat > /dev/null; shift 2 ;; # read the config, as curl does
    -H|-u) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  "https://ghcr.io/token?"*) echo '{"token":"pull-token"}'; exit 0 ;;
  "https://ghcr.io/v2/${REPO}/manifests/"*) f="$REGISTRY/manifests/$(printf '%s' "\${url##*/}" | tr -c 'A-Za-z0-9' '_')" ;;
  "https://ghcr.io/v2/${REPO}/blobs/"*) f="$REGISTRY/blobs/$(printf '%s' "\${url##*/}" | tr -c 'A-Za-z0-9' '_')" ;;
  *) echo "curl stub: unexpected url $url" >&2; exit 2 ;;
esac
[ -f "$f" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
if [ -n "$out" ]; then cat "$f" > "$out"; else cat "$f"; fi`,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function gate(args: string[] = [SHA]) {
  const result = spawnSync("/bin/bash", [SCRIPT, ...args], {
    env: {
      PATH: stubDir,
      GH_TOKEN: "github-token",
      GITHUB_ACTOR: "andrianm28",
      GITHUB_REPOSITORY: REPO,
      GITHUB_OUTPUT: outputFile,
      GH_FIXTURES: fixtures,
      REGISTRY: registry,
    } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  const outputs = Object.fromEntries(
    readFileSync(outputFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  return { ...result, outputs };
}

describe("ci/deploy-gate.sh", () => {
  it("resolves a CI-green commit on main to the digests of the images cd.yml pushed for it", () => {
    releasable();
    const app = publish(SHA, "runner");
    const migrate = publish(`${SHA}-migrate`, "migrate");

    const r = gate();

    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.outputs).toEqual({
      sha: SHA,
      "app-digest": app,
      "migrate-digest": migrate,
      "ci-run": String(CI_RUN),
      "build-run": String(BUILD_RUN),
    });
  });

  it("deploys main's head when no commit is given", () => {
    gh(`repos/${REPO}/commits/main`, { sha: MAIN_HEAD });
    releasable(MAIN_HEAD);
    const app = publish(MAIN_HEAD, "runner", { revision: MAIN_HEAD });
    publish(`${MAIN_HEAD}-migrate`, "migrate", { revision: MAIN_HEAD });

    const r = gate([]);

    expect(r.status).toBe(0);
    expect(r.outputs.sha).toBe(MAIN_HEAD);
    expect(r.outputs["app-digest"]).toBe(app);
  });

  describe("refuses, writing no outputs,", () => {
    function expectRefused(r: ReturnType<typeof gate>, reason: RegExp) {
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/^::error::Refusing to deploy: /m);
      expect(r.stdout).toMatch(reason);
      expect(r.outputs).toEqual({});
    }

    beforeEach(() => {
      releasable();
      publish(SHA, "runner");
      publish(`${SHA}-migrate`, "migrate");
    });

    it.each([
      ["a short SHA", "3f2c3f2"],
      ["an upper-case SHA", SHA.toUpperCase()],
      ["a branch name", "main"],
      ["a SHA with more words", `${SHA} sha256:${"a".repeat(64)}`],
      ["shell syntax", `$(touch /tmp/pwned)${SHA.slice(16)}`],
    ])("%s", (_, input) => {
      expectRefused(gate([input]), /not a full 40-hex commit SHA/);
    });

    it("a commit that is not on main", () => {
      gh(`repos/${REPO}/compare/main...${SHA}`, { status: "diverged" });
      expectRefused(gate(), /not on main/);
    });

    it("a commit GitHub does not know", () => {
      rmSync(join(fixtures, key(`repos/${REPO}/compare/main...${SHA}`)));
      expectRefused(gate(), /not on main/);
    });

    it("a commit with no green CI run on main", () => {
      gh(`repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&branch=main&event=push&status=success`, {
        total_count: 0,
        workflow_runs: [],
      });
      expectRefused(gate(), /CI has not passed/);
    });

    // GitHub's runs endpoint ignores `conclusion=` and filters on `status=`
    // alone, so it will not really hand back a failed run under a successful
    // one. These are not claims about what the API returns; they are what keeps
    // that from being the gate's only protection. If `status=` is renamed or
    // dropped and the endpoint starts answering with everything, the run is
    // still checked on its own fields here, and the gate has to refuse.
    it.each<[string, string]>([
      ["conclusion", "failure"],
      ["conclusion", "cancelled"],
    ])("a run whose own %s is %s, whatever the request filter said", (_, conclusion) => {
      gh(`repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&branch=main&event=push&status=success`, {
        total_count: 1,
        workflow_runs: [
          { id: CI_RUN, head_sha: SHA, head_branch: "main", event: "push", status: "completed", conclusion },
        ],
      });
      // Its jobs are green, so only the run's own conclusion can refuse this.
      expectRefused(gate(), /CI has not passed/);
    });

    it("a run of another commit, served under this commit's filter", () => {
      gh(`repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&branch=main&event=push&status=success`, {
        total_count: 1,
        workflow_runs: [
          { id: CI_RUN, head_sha: MAIN_HEAD, head_branch: "main", event: "push", status: "completed", conclusion: "success" },
        ],
      });
      expectRefused(gate(), /CI has not passed/);
    });

    it.each<[string, { head_branch: string; event: string }]>([
      ["a pull request", { head_branch: "main", event: "pull_request" }],
      ["another branch", { head_branch: "feature", event: "push" }],
    ])("a run of %s", (_, run) => {
      gh(`repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&branch=main&event=push&status=success`, {
        total_count: 1,
        workflow_runs: [{ id: CI_RUN, head_sha: SHA, status: "completed", conclusion: "success", ...run }],
      });
      expectRefused(gate(), /CI has not passed/);
    });

    it.each<[string, string]>([
      ["skipped", "skipped"],
      ["cancelled", "cancelled"],
      ["failed", "failure"],
    ])("a green CI run whose ratchet job is %s", (_, conclusion) => {
      gh(`repos/${REPO}/actions/runs/${CI_RUN}/jobs`, {
        total_count: 5,
        jobs: [
          { name: "test", conclusion: "success" },
          { name: "ratchet", conclusion },
          { name: "migrations", conclusion: "success" },
          { name: "build", conclusion: "success" },
          { name: "e2e", conclusion: "success" },
        ],
      });
      expectRefused(gate(), /no green `ratchet` job/);
    });

    it("a green CI run whose ratchet job is still running", () => {
      gh(`repos/${REPO}/actions/runs/${CI_RUN}/jobs`, {
        total_count: 5,
        jobs: [
          { name: "test", conclusion: "success" },
          { name: "ratchet", conclusion: null },
          { name: "migrations", conclusion: "success" },
          { name: "build", conclusion: "success" },
          { name: "e2e", conclusion: "success" },
        ],
      });
      expectRefused(gate(), /no green `ratchet` job/);
    });

    it("a green CI run that lacks one of test, build, migrations, ratchet", () => {
      gh(`repos/${REPO}/actions/runs/${CI_RUN}/jobs`, {
        total_count: 4,
        jobs: [
          { name: "test", conclusion: "success" },
          { name: "ratchet", conclusion: "skipped" },
          { name: "migrations", conclusion: "success" },
          { name: "build", conclusion: "success" },
        ],
      });
      expectRefused(gate(), /ratchet/);
    });

    it("a green CI run whose test shards passed but whose `test` aggregate did not (ticket 26)", () => {
      gh(`repos/${REPO}/actions/runs/${CI_RUN}/jobs`, {
        total_count: 7,
        jobs: [
          ...[1, 2, 3].map((i) => ({ name: `test-shard (${i}/3)`, conclusion: "success" })),
          { name: "test", conclusion: "skipped" },
          { name: "ratchet", conclusion: "success" },
          { name: "migrations", conclusion: "success" },
          { name: "build", conclusion: "success" },
        ],
      });
      expectRefused(gate(), /no green `test` job/);
    });

    it("a green CI run with test shards but no `test` aggregate at all (ticket 26)", () => {
      gh(`repos/${REPO}/actions/runs/${CI_RUN}/jobs`, {
        total_count: 6,
        jobs: [
          ...[1, 2, 3].map((i) => ({ name: `test-shard (${i}/3)`, conclusion: "success" })),
          { name: "ratchet", conclusion: "success" },
          { name: "migrations", conclusion: "success" },
          { name: "build", conclusion: "success" },
        ],
      });
      expectRefused(gate(), /no green `test` job/);
    });

    it.each([
      ["the app image", SHA],
      ["the migrate image", `${SHA}-migrate`],
    ])("a commit without %s in GHCR", (_, tag) => {
      rmSync(join(registry, "manifests", key(tag)));
      expectRefused(gate(), new RegExp(`no image ghcr.io/${REPO}:${tag}\\b`));
    });

    it("an image with no provenance attestation", () => {
      publish(SHA, "runner", { noAttestation: true });
      expectRefused(gate(), /no provenance/);
    });

    it("a provenance blob whose bytes do not match its digest", () => {
      publish(SHA, "runner", { tamperProvenance: true });
      expectRefused(gate(), /does not match its digest/);
    });

    it("provenance that describes a different image", () => {
      publish(SHA, "runner", { subjectDigest: sha256("some other image") });
      expectRefused(gate(), /does not describe/);
    });

    it.each<[string, ImageOptions]>([
      ["another commit", { revision: MAIN_HEAD }],
      ["another repository", { source: "https://github.com/someone/fork" }],
    ])("an image built from %s", (_, o) => {
      publish(SHA, "runner", o);
      expectRefused(gate(), /was built from/);
    });

    it("provenance that tries to smuggle in a workflow command, keeping it on the one error line", () => {
      publish(SHA, "runner", { source: "https://x\n::add-mask::oops\r%0A::notice::pwned" });
      const r = gate();
      expectRefused(r, /was built from/);
      expect(r.stdout.split("\n").filter((l) => l.startsWith("::"))).toHaveLength(1);
      expect(r.stdout).toContain("%250A");
    });

    it("an app tag that holds the migrate build", () => {
      publish(SHA, "runner", { target: "migrate" });
      expectRefused(gate(), /target/);
    });

    it("an image whose builder is not a GitHub Actions run of this repository", () => {
      publish(SHA, "runner", { builderId: `https://github.com/someone/fork/actions/runs/${BUILD_RUN}/attempts/1` });
      expectRefused(gate(), /not built by a cd.yml run on main/);
    });

    it.each<[string, { path: string; head_branch: string }]>([
      ["another workflow", { path: ".github/workflows/ci.yml", head_branch: "main" }],
      ["another branch", { path: ".github/workflows/cd.yml", head_branch: "feature" }],
    ])("an image built by a run of %s", (_, run) => {
      gh(`repos/${REPO}/actions/runs/${BUILD_RUN}`, { id: BUILD_RUN, event: "workflow_dispatch", ...run });
      expectRefused(gate(), /not built by a cd.yml run on main/);
    });

    it("app and migrate images from different cd.yml runs", () => {
      gh(`repos/${REPO}/actions/runs/778`, { id: 778, path: ".github/workflows/cd.yml", head_branch: "main" });
      publish(`${SHA}-migrate`, "migrate", { builderId: `https://github.com/${REPO}/actions/runs/778/attempts/1` });
      expectRefused(gate(), /different cd.yml runs/);
    });
  });
});
