// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards docker-compose.staging.yml (go-live-ops 02).
 *
 * Staging runs beside production on the same kind of host, so what matters is
 * that the two can never share state or be confused for each other:
 * - its own Compose project, database and volumes (none external, none of the
 *   production or kibi-clone names), and ports that do not collide;
 * - nothing built on the host, images pinned by digest, and nothing listening
 *   beyond loopback;
 * - every value read from a STAGING_-prefixed variable, so a production .env
 *   that happens to be in scope cannot reach it by a name collision;
 * - DEPLOY_ENVIRONMENT=staging is passed here and, deliberately, never by
 *   docker-compose.prod.yml, because it is what permits the Sumopod sandbox.
 *
 * Same small indentation reader as docker-compose-prod.test.ts.
 */
const read = (f: string) => readFileSync(resolve(f), "utf8");
const staging = read("docker-compose.staging.yml");
const prod = read("docker-compose.prod.yml");
const lines = staging.split("\n");

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
const envNames = (text: string[]) =>
  text.map((l) => l.match(/^ {6}([A-Z][A-Z0-9_]*):/)?.[1]).filter((n): n is string => Boolean(n));
/** Non-comment text, so a comment may mention what the file must not contain. */
const code = lines.filter((l) => !l.trim().startsWith("#")).join("\n");

describe("docker-compose.staging.yml", () => {
  it("has its own project name, not production's and not the other fund-for-indonesia stack", () => {
    expect(lines).toContain("name: fundforindonesia-staging");
    expect(lines).not.toContain("name: fundforindonesia-prod");
    expect(lines).not.toContain("name: fund-for-indonesia");
  });

  it("has the app, a one-off migrate and the db", () => {
    expect(serviceNames).toEqual(expect.arrayContaining(["app", "migrate", "db"]));
  });

  it("never builds on the host, and pins the app and migrate images by digest", () => {
    expect(staging).not.toMatch(/^\s*build:/m);
    expect(service("app")).toContain(
      "    image: ghcr.io/andrianm28/fundforindonesia.org@${APP_DIGEST:?set APP_DIGEST}",
    );
    expect(service("migrate")).toContain(
      "    image: ghcr.io/andrianm28/fundforindonesia.org@${MIGRATE_DIGEST:?set MIGRATE_DIGEST}",
    );
  });

  it("keeps migrate out of a plain `up`", () => {
    expect(block("    profiles:", service("migrate")).map((l) => l.trim())).toEqual(["- migrate"]);
  });

  it("owns its volumes: declared locally, never external, never production's or kibi-clone's", () => {
    const volumes = block("volumes:");
    expect(volumes.map((l) => l.trim()).sort()).toEqual(["postgres_data:", "uploads:"]);
    expect(code).not.toMatch(/external:/);
    expect(code).not.toMatch(/kibi-clone/);
    expect(code).not.toMatch(/fundforindonesia-prod/);
  });

  it("uses its own database name and user, apart from production's", () => {
    const env = block("    environment:", service("db")).map((l) => l.trim());
    expect(env).toContain("POSTGRES_DB: fund_indonesia_staging");
    expect(env).toContain("POSTGRES_USER: fundindo_staging");
    expect(code).not.toMatch(/\/fund_indonesia\?/);
  });

  it("publishes ports other than production's, on loopback only", () => {
    const ports = serviceNames.flatMap((name) =>
      service(name).some((l) => l === "    ports:")
        ? block("    ports:", service(name)).map((l) => `${name} ${l.trim()}`)
        : [],
    );
    expect(ports.sort()).toEqual([
      'app - "127.0.0.1:8094:3000"',
      'db - "127.0.0.1:18094:5432"',
    ]);
    expect(prod).not.toMatch(/8094|18094/);
  });

  it("reads every interpolated value from a STAGING_ variable, apart from the two digests", () => {
    const names = [...code.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
    const foreign = names.filter((n) => !n.startsWith("STAGING_") && n !== "APP_DIGEST" && n !== "MIGRATE_DIGEST");
    expect(foreign).toEqual([]);
  });

  it("marks the app as staging, and requires the sandbox url or a default of it", () => {
    const env = block("    environment:", service("app")).map((l) => l.trim());
    expect(env).toContain("DEPLOY_ENVIRONMENT: staging");
    expect(env).toContain(
      "SUMOPOD_BASE_URL: ${STAGING_SUMOPOD_BASE_URL:-https://api-pay-sandbox.sumopod.com/api/v1}",
    );
    expect(env).toContain("PAYMENT_PROVIDER: sumopod");
  });

  it("passes the app everything production passes, so staging runs the same code paths", () => {
    const stagingEnv = new Set(envNames(block("    environment:", service("app"))));
    const prodApp = block("  app:", block("services:", prod.split("\n")));
    const prodEnv = envNames(block("    environment:", prodApp));
    // The mock adapter is refused in production mode whatever the flags say,
    // and staging never wants it, so neither of its two variables is carried over.
    const NOT_CARRIED = new Set(["ALLOW_MOCK_PAYMENT_PROVIDER", "MOCK_MIDTRANS_SERVER_KEY"]);
    expect(
      prodEnv.filter((n) => !NOT_CARRIED.has(n) && !stagingEnv.has(n)),
      "a variable added to the production app environment must be added to docker-compose.staging.yml too",
    ).toEqual([]);
    expect(stagingEnv.has("DEPLOY_ENVIRONMENT")).toBe(true);
  });

  it("never turns the mock payment adapter on", () => {
    expect(code).not.toMatch(/ALLOW_MOCK_PAYMENT_PROVIDER/);
  });
});

describe("docker-compose.prod.yml and the staging marker", () => {
  it("never passes DEPLOY_ENVIRONMENT, so a production .env cannot permit the sandbox", () => {
    const codeOnly = prod
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(codeOnly).not.toMatch(/DEPLOY_ENVIRONMENT/);
  });
});
