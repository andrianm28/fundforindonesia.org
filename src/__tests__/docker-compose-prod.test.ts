// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

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
 */
describe("docker-compose.prod.yml env passthrough", () => {
  // Read by code under src/ but deliberately not passed to the app container.
  const NOT_PASSED = new Set([
    "NODE_ENV", // set by the image
    "TEST_DATABASE_URL", // tests only
    "LEDGER_CLAIM_TEST_DATABASE_URL", // tests only
  ]);

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      const isSource = /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name);
      return isSource && !p.includes("__tests__") ? [p] : [];
    });
  }

  it("lists every env variable the server code reads", () => {
    const used = new Set<string>();
    for (const file of walk(resolve("src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) used.add(m[1]);
      for (const m of text.matchAll(/requireEnv\(\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\)/g)) used.add(m[1]);
      for (const m of text.matchAll(/_ENV\s*=\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) used.add(m[1]);
    }
    const passed = new Set(
      service("app")
        .map((l) => l.match(/^ {6}([A-Z][A-Z0-9_]*):/)?.[1])
        .filter((n): n is string => Boolean(n)),
    );
    const missing = [...used]
      .filter((n) => !n.startsWith("NEXT_PUBLIC_") && !NOT_PASSED.has(n) && !passed.has(n))
      .sort();
    expect(missing, "add to the app environment: block, or to NOT_PASSED with a reason").toEqual([]);
  });
});
