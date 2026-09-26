// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the production compose file against host bind mounts over the app's
 * baked-in public/ tree.
 *
 * The image already carries public/ chowned to nextjs:nodejs (see the
 * Dockerfile). A bind mount such as `./public/images:/app/public/images`
 * replaces that copy with the host checkout's directory, whose modes are
 * drwxrwx--- ubuntu:ubuntu. Next scans public/ at startup, so that one
 * unreadable directory crash-loops the container with EACCES, and every host
 * sync reintroduces it. Production (kibi-clone 0045c62) dropped the mount for
 * exactly this reason.
 *
 * A deliberately small reader instead of a YAML dependency: it takes the
 * `volumes:` list of one service by indentation, which is all this needs.
 */
function serviceVolumes(compose: string, service: string): string[] {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l === `  ${service}:`);
  if (start === -1) throw new Error(`service ${service} not found`);
  const volumes: string[] = [];
  let inVolumes = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break; // next service or top-level key
    if (/^ {4}\S/.test(line)) {
      inVolumes = line.trim() === "volumes:";
      continue;
    }
    const entry = line.match(/^ {6}- (\S+)/);
    if (inVolumes && entry) volumes.push(entry[1]);
  }
  return volumes;
}

const compose = readFileSync(resolve("docker-compose.yml"), "utf8");

describe("docker-compose.yml app service", () => {
  const volumes = serviceVolumes(compose, "app");

  it("keeps uploads on the named volume", () => {
    expect(volumes).toContain("uploads:/app/public/uploads");
  });

  it("never bind-mounts a host path over the image's public/ tree", () => {
    const hostMountsOverPublic = volumes.filter((v) => {
      const [source, target = ""] = v.split(":");
      const isHostPath = source.startsWith(".") || source.startsWith("/");
      return isHostPath && target.startsWith("/app/public");
    });
    expect(hostMountsOverPublic).toEqual([]);
  });
});
