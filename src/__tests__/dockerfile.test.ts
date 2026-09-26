// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CANONICAL_PUBLIC_URL } from "@/lib/public-url";

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
  it("takes the build-time public values as build args, with production's values as defaults", () => {
    const builder = stage("builder");
    expect(builder).toContain('ARG NEXT_PUBLIC_BASE_URL="https://fundforindonesia.org"');
    expect(builder).toContain('ARG NEXTAUTH_URL="https://galang.fundforindonesia.org"');
    expect(builder).toContain('ARG NEXT_PUBLIC_DONATIONS_ENABLED="false"');
    expect(builder).toContain("ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL");
    expect(builder).toContain("ENV NEXTAUTH_URL=$NEXTAUTH_URL");
    expect(builder).toContain("ENV NEXT_PUBLIC_DONATIONS_ENABLED=$NEXT_PUBLIC_DONATIONS_ENABLED");
  });

  it("defaults NEXT_PUBLIC_BASE_URL to the canonical public domain, the same in cd.yml and the app", () => {
    const cd = readFileSync(resolve(".github/workflows/cd.yml"), "utf8");
    expect(CANONICAL_PUBLIC_URL).toBe("https://fundforindonesia.org");
    expect(stage("builder")).toContain(`ARG NEXT_PUBLIC_BASE_URL="${CANONICAL_PUBLIC_URL}"`);
    expect(cd).toContain(`NEXT_PUBLIC_BASE_URL=\${{ vars.NEXT_PUBLIC_BASE_URL || '${CANONICAL_PUBLIC_URL}' }}`);
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

  // Ticket 14: an `npm install` in the runner reifies the whole dependency
  // tree (next's SWC compiler, prisma's CLI and studio, typescript, …), which
  // made the image over a gigabyte. The standalone output already holds every
  // runtime file the server needs, the Prisma client included (webpack
  // bundles it), so the runner installs nothing and copies no node_modules.
  it("runs the app from the standalone output alone, installing no packages in the runner", () => {
    const runner = stage("runner");
    expect(runner.filter((l) => /\bnpm\b/.test(l))).toEqual([]);
    const copies = runner.filter((l) => l.startsWith("COPY "));
    expect(copies.filter((l) => /node_modules|src\/generated|\/app\/prisma/.test(l) && !l.includes("--from=sharp"))).toEqual([]);
    expect(copies).toContain("COPY --from=builder /app/.next/standalone ./");
  });

  // next/image needs sharp in a standalone build. It is installed on its own,
  // at an exact version, for the image's own platform (alpine/musl), and Next
  // loads it from there through NEXT_SHARP_PATH (next/dist/server/image-optimizer).
  it("gives the runner sharp at a pinned version from its own stage, where Next looks for it", () => {
    const sharp = stage("sharp");
    expect(sharp).toContainEqual(expect.stringMatching(/^ARG SHARP_VERSION="\d+\.\d+\.\d+"$/));
    expect(sharp).toContainEqual(expect.stringMatching(/npm install .*sharp@\$SHARP_VERSION/));
    const runner = stage("runner");
    expect(runner).toContain("COPY --from=sharp /opt/sharp/node_modules /opt/sharp/node_modules");
    expect(runner).toContain("ENV NEXT_SHARP_PATH=/opt/sharp/node_modules/sharp");
  });

  it("is proven by cd.yml: sharp really loads in the built app image, and both image sizes are reported", () => {
    const cd = readFileSync(resolve(".github/workflows/cd.yml"), "utf8");
    // The optimizer is off, so /api/health would pass with sharp broken; this
    // runs sharp itself, through the same path Next uses.
    expect(cd).toMatch(/docker run --rm local\/app:candidate node -e '[^']*require\(process\.env\.NEXT_SHARP_PATH\)/);
    // Ticket 14 asked for the size to be measured; keep it visible on every run.
    expect(cd).toMatch(/docker image inspect --format '\{\{\.Size\}\}' local\/app:candidate/);
    expect(cd).toMatch(/docker image inspect --format '\{\{\.Size\}\}' local\/migrate:candidate/);
  });

  it("builds the app runtime by default, as the non-root nextjs user", () => {
    expect(Array.from(byStage.keys()).at(-1)).toBe("runner");
    expect(stage("runner")).toContain("USER nextjs");
  });
});
