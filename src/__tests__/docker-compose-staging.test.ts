// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards docker-compose.staging.yml (stg.fundforindonesia.org): a stack on the
 * production host that must never share production's data, ports or project,
 * and that is always the Sumopod sandbox. See docs/runbooks/staging.md.
 */
const staging = readFileSync(resolve("docker-compose.staging.yml"), "utf8");
const prod = readFileSync(resolve("docker-compose.prod.yml"), "utf8");
const code = staging
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

describe("docker-compose.staging.yml", () => {
  it("has its own project name", () => {
    expect(code).toMatch(/^name: fundforindonesia-stg$/m);
  });

  it("never names production's volumes, project or database", () => {
    expect(code).not.toMatch(/kibi-clone|fundforindonesia-prod|ffi_private_documents|fund_indonesia\?/);
    const external = [...code.matchAll(/^ {4}name: (\S+)$/gm)].map((m) => m[1]);
    expect(external.sort()).toEqual(["ffi_stg_postgres_data", "ffi_stg_private_documents", "ffi_stg_uploads"]);
    expect(code.match(/external: true/g)).toHaveLength(3);
  });

  it("listens on loopback only, on ports production does not use", () => {
    const ports = [...code.matchAll(/^\s+- "([^"]+)"$/gm)].map((m) => m[1]).filter((p) => /:\d+$/.test(p));
    expect(ports.sort()).toEqual(["127.0.0.1:18094:5432", "127.0.0.1:8094:3000"]);
    for (const p of ports) expect(prod).not.toContain(p.split(":").slice(0, 2).join(":") + ":");
  });

  it("is the sandbox unless the staging .env says otherwise, and never builds", () => {
    expect(code).toContain("BETA_SANDBOX: ${BETA_SANDBOX:-true}");
    expect(code).not.toMatch(/^\s*build:/m);
    expect(code.match(/image: ghcr\.io\/andrianm28\/fundforindonesia\.org@\$\{(APP|MIGRATE)_DIGEST:\?/g)).toHaveLength(2);
  });

  it("caps resources below production's", () => {
    expect(code).toMatch(/mem_limit: 768m/);
    expect(code.match(/cpus: 0\.5/g)).toHaveLength(2);
  });
});
