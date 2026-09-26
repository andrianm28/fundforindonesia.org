// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the Dockerfile that cd.yml builds for production (ticket 05).
 *
 * The image is built once in Actions and deployed as-is, so everything Next
 * inlines at build time must be a build arg that cd.yml can set, not a value
 * hardcoded here. The migrate target must be able to run `prisma migrate
 * deploy` on its own, and neither image may run as root.
 */
const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");

/** Instructions per stage, keyed by the stage name in `FROM … AS name`. */
function stages(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const raw of dockerfile.replace(/\\\n\s*/g, " ").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const from = line.match(/^FROM\s+\S+\s+AS\s+(\S+)$/i);
    if (from) {
      current = [];
      out.set(from[1], current);
      continue;
    }
    current?.push(line);
  }
  return out;
}

const byStage = stages();
const stage = (name: string) => {
  const s = byStage.get(name);
  if (!s) throw new Error(`stage ${name} not found`);
  return s;
};

describe("Dockerfile", () => {
  it("takes the build-time public values as build args, with today's values as defaults", () => {
    const builder = stage("builder");
    expect(builder).toContain('ARG NEXT_PUBLIC_BASE_URL="https://galang.fundforindonesia.org"');
    expect(builder).toContain('ARG NEXTAUTH_URL="https://galang.fundforindonesia.org"');
    expect(builder).toContain('ARG NEXT_PUBLIC_DONATIONS_ENABLED="false"');
    expect(builder).toContain("ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL");
    expect(builder).toContain("ENV NEXTAUTH_URL=$NEXTAUTH_URL");
    expect(builder).toContain("ENV NEXT_PUBLIC_DONATIONS_ENABLED=$NEXT_PUBLIC_DONATIONS_ENABLED");
  });

  it("hardcodes no production URL outside the build arg defaults", () => {
    const hardcoded = dockerfile
      .split("\n")
      .filter((l) => l.includes("fundforindonesia") && !l.trim().startsWith("ARG ") && !l.trim().startsWith("#"));
    expect(hardcoded).toEqual([]);
  });

  it("has a migrate target that runs prisma migrate deploy as a non-root user", () => {
    const migrate = stage("migrate");
    expect(migrate).toContain("COPY --chown=node:node prisma ./prisma");
    expect(migrate).toContain("COPY --chown=node:node prisma.config.ts ./");
    expect(migrate).toContain("USER node");
    expect(migrate).toContain('CMD ["node_modules/.bin/prisma", "migrate", "deploy"]');
  });

  it("builds the app runtime by default, as the non-root nextjs user", () => {
    expect(Array.from(byStage.keys()).at(-1)).toBe("runner");
    expect(stage("runner")).toContain("USER nextjs");
  });
});
