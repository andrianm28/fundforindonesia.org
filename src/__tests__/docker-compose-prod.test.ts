// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * Guards docker-compose.prod.yml, the file the host deploys from
 * (.scratch/ci-cd-github-actions, ticket 05).
 *
 * - The host never builds: every service runs a pre-built image.
 * - The production data volumes are the existing kibi-clone ones, declared
 *   external under their exact names, so `docker compose down -v` cannot delete
 *   them and running from a different directory cannot create empty ones.
 * - Nothing listens beyond loopback; nginx is the only public entry.
 *
 * Like docker-compose.test.ts, a small indentation reader rather than a YAML
 * dependency. It reads the block under one key and fails loudly when the key
 * is missing.
 */
const compose = readFileSync(resolve("docker-compose.prod.yml"), "utf8");
const lines = compose.split("\n");

/** The lines nested under the line equal to `header`, until indentation drops back. */
function block(header: string, from = lines): string[] {
  const start = from.findIndex((l) => l === header);
  if (start === -1) throw new Error(`"${header.trim()}" not found`);
  const indent = header.match(/^ */)![0].length;
  const out: string[] = [];
  for (const line of from.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (line.match(/^ */)![0].length <= indent) break;
    out.push(line);
  }
  return out;
}

const services = block("services:");
const serviceNames = services
  .map((l) => l.match(/^ {2}([\w-]+):\s*$/)?.[1])
  .filter((n): n is string => Boolean(n));
const service = (name: string) => block(`  ${name}:`, services);

describe("docker-compose.prod.yml", () => {
  it("has a fixed project name that is not the other fund-for-indonesia stack", () => {
    expect(lines).toContain("name: fundforindonesia-prod");
  });

  it("has the app, a one-off migrate and the db", () => {
    expect(serviceNames).toEqual(expect.arrayContaining(["app", "migrate", "db"]));
  });

  it("never builds on the host", () => {
    expect(compose).not.toMatch(/^\s*build:/m);
    for (const name of serviceNames) {
      expect(service(name).some((l) => /^ {4}image: \S/.test(l)), name).toBe(true);
    }
  });

  it("runs the app and migrate images from GHCR pinned by digest", () => {
    expect(service("app")).toContain(
      "    image: ghcr.io/andrianm28/fundforindonesia.org@${APP_DIGEST:?set APP_DIGEST}",
    );
    expect(service("migrate")).toContain(
      "    image: ghcr.io/andrianm28/fundforindonesia.org@${MIGRATE_DIGEST:?set MIGRATE_DIGEST}",
    );
  });

  it("keeps migrate out of a plain `up`", () => {
    expect(block("    profiles:", service("migrate")).map((l) => l.trim())).toEqual([
      "- migrate",
    ]);
  });

  it("reuses the kibi-clone data volumes as external, by exact name", () => {
    const volumes = block("volumes:");
    expect(block("  postgres_data:", volumes).map((l) => l.trim())).toEqual([
      "external: true",
      "name: kibi-clone_postgres_data",
    ]);
    expect(block("  uploads:", volumes).map((l) => l.trim())).toEqual([
      "external: true",
      "name: kibi-clone_uploads",
    ]);
    expect(block("    volumes:", service("db")).map((l) => l.trim())).toEqual([
      "- postgres_data:/var/lib/postgresql/data",
    ]);
    expect(block("    volumes:", service("app")).map((l) => l.trim())).toEqual([
      "- uploads:/app/public/uploads",
    ]);
  });

  it("publishes the same ports as today, on loopback only", () => {
    const ports = serviceNames.flatMap((name) =>
      service(name).some((l) => l === "    ports:")
        ? block("    ports:", service(name)).map((l) => `${name} ${l.trim()}`)
        : [],
    );
    expect(ports.sort()).toEqual([
      'app - "127.0.0.1:8093:3000"',
      'db - "127.0.0.1:18093:5432"',
    ]);
  });
});

/**
 * Compose passes env to the app container by listing it (ops/deploy.sh only
 * hands .env to compose for interpolation), so a variable the server code reads
 * but the app service does not list never reaches the container: the jobs
 * endpoint answers 503 and mail is never sent.
 *
 * Detection limits, stated honestly. This is a textual scan, not a data-flow
 * analysis. It finds names written as a literal at the point of use:
 * `process.env.X`, `process.env["X"]`, `process.env['X']`, `requireEnv('X')`
 * and a constant assigned as `..._ENV = 'X'`. It cannot see a name that
 * reaches `process.env[key]` through a variable, or a whole `process.env`
 * handed to another function. Those are covered by DYNAMIC_READERS below: a
 * hand-kept list of the files that do this and the names they read. The test
 * fails when a file starts reading env dynamically without being listed (and
 * when a listed name no longer appears in its file), so the list cannot
 * silently go stale, but the names in it are only as accurate as the author
 * made them.
 */
describe("docker-compose.prod.yml env passthrough", () => {
  // Read by code under src/ but deliberately not passed to the app container.
  const NOT_PASSED = new Set([
    "NODE_ENV", // set by the image
    "NEXT_RUNTIME", // set by Next.js itself
    "TEST_DATABASE_URL", // tests only
    "LEDGER_CLAIM_TEST_DATABASE_URL", // tests only
    // CI-only opt-out of the localhost check in src/lib/env-check.ts, set by the
    // e2e job and the image smoke test. It must never reach production.
    "ALLOW_LOCAL_AUTH_URL",
  ]);

  /** One env variable name: the single definition every pattern below reuses. */
  const ENV_NAME = "[A-Z][A-Z0-9_]*";
  const LITERAL_READS = [
    new RegExp(`process\\.env\\.(${ENV_NAME})`, "g"),
    new RegExp(`process\\.env\\[\\s*["'](${ENV_NAME})["']\\s*\\]`, "g"),
    new RegExp(`requireEnv\\(\\s*["'](${ENV_NAME})["']\\s*\\)`, "g"),
    new RegExp(`_ENV\\s*=\\s*["'](${ENV_NAME})["']`, "g"),
  ];
  /** `process.env[x]` with a non-literal key, or `process.env` passed whole. */
  const DYNAMIC_READ = new RegExp(
    `process\\.env\\[\\s*(?!["']${ENV_NAME}["']\\s*\\])|process\\.env(?![.\\[\\w])`,
  );

  /** Files that read env by a computed key or a whole `process.env`, and what they read. */
  const DYNAMIC_READERS: Record<string, string[]> = {
    // requireEnv(key) with literal callers, plus PARTNERSHIP_TEAM_EMAIL_ENV.
    "src/lib/mail/index.ts": ["SMTP_PORT", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"],
    "src/lib/payments/index.ts": [
      "MOCK_MIDTRANS_SERVER_KEY",
      "SUMOPOD_API_KEY",
      "SUMOPOD_WEBHOOK_SECRET",
      "SUMOPOD_BASE_URL",
    ],
    "src/lib/partnership-inquiries.ts": ["PARTNERSHIP_TEAM_EMAIL"],
    // loadFieldKeys(process.env) at boot; the names are VARS in field-encryption.ts.
    "src/lib/env-check.ts": [
      "FIELD_ENCRYPTION_KEY",
      "FIELD_ENCRYPTION_KEY_ID",
      "FIELD_HMAC_KEY",
      "FIELD_HMAC_KEY_ID",
    ],
    // loadFieldKeys(process.env); the names are VARS in field-encryption.ts.
    "src/lib/contact-fields.ts": [
      "FIELD_ENCRYPTION_KEY",
      "FIELD_ENCRYPTION_KEY_ID",
      "FIELD_HMAC_KEY",
      "FIELD_HMAC_KEY_ID",
    ],
  };

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      const isSource = /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name);
      return isSource && !p.includes("__tests__") ? [p] : [];
    });
  }

  const sources = walk(resolve("src")).map((file) => ({
    rel: relative(resolve("."), file).split(sep).join("/"),
    text: readFileSync(file, "utf8"),
  }));

  const passed = new Set(
    service("app")
      .map((l) => l.match(/^ {6}([A-Z][A-Z0-9_]*):/)?.[1])
      .filter((n): n is string => Boolean(n)),
  );

  it("lists every env variable the server code reads", () => {
    const used = new Set<string>(Object.values(DYNAMIC_READERS).flat());
    for (const { text } of sources) {
      for (const re of LITERAL_READS) for (const m of text.matchAll(re)) used.add(m[1]);
    }
    const missing = [...used]
      .filter((n) => !n.startsWith("NEXT_PUBLIC_") && !NOT_PASSED.has(n) && !passed.has(n))
      .sort();
    expect(missing, "add to the app environment: block, or to NOT_PASSED with a reason").toEqual([]);
  });

  it("knows every file that reads env dynamically", () => {
    const dynamic = sources.filter((s) => DYNAMIC_READ.test(s.text)).map((s) => s.rel);
    const unlisted = dynamic.filter((f) => !(f in DYNAMIC_READERS));
    expect(unlisted, "register the names it reads in DYNAMIC_READERS").toEqual([]);
  });

  it("keeps DYNAMIC_READERS honest about the files it names", () => {
    for (const [file, names] of Object.entries(DYNAMIC_READERS)) {
      const src = sources.find((s) => s.rel === file);
      expect(src, `${file} no longer exists`).toBeDefined();
      expect(DYNAMIC_READ.test(src!.text), `${file} no longer reads env dynamically`).toBe(true);
      for (const name of names) {
        const inFile = src!.text.includes(name) || (file.endsWith("contact-fields.ts") &&
          sources.find((s) => s.rel === "src/lib/field-encryption.ts")!.text.includes(name));
        expect(inFile, `${name} not found for ${file}`).toBe(true);
      }
    }
  });

  it("recognises the literal read patterns, including bracket access", () => {
    const found = (code: string) =>
      LITERAL_READS.flatMap((re) => [...code.matchAll(new RegExp(re))].map((m) => m[1]));
    expect(found("process.env.A_B")).toEqual(["A_B"]);
    expect(found('process.env["C_D"]')).toEqual(["C_D"]);
    expect(found("process.env['E_F']")).toEqual(["E_F"]);
    expect(DYNAMIC_READ.test("process.env[key]")).toBe(true);
    expect(DYNAMIC_READ.test("load(process.env)")).toBe(true);
    expect(DYNAMIC_READ.test('process.env["X"]')).toBe(false);
  });

  it("gives JOBS_SECRET no non-empty default", () => {
    const line = service("app").find((l) => /^ {6}JOBS_SECRET:/.test(l));
    expect(line, "JOBS_SECRET must be passed to app").toBeDefined();
    // Only `${JOBS_SECRET}` or `${JOBS_SECRET:-}` / `${JOBS_SECRET-}`: an empty
    // default fails closed (503); a published default would be a known secret.
    expect(line!.trim()).toMatch(/^JOBS_SECRET: \$\{JOBS_SECRET:?-?\}$/);
  });
});
