import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * prisma/seed.ts cannot be executed in this test process -- it opens a real
 * Postgres connection at module scope via PrismaPg -- so, matching the
 * existing precedent for this file
 * (src/__tests__/properties/seed-user-assignments.test.ts), this asserts
 * against the source text rather than running it.
 *
 * The public repo cleanup drops the seed's "Test Credentials" banner: it
 * printed the shared seed password in plaintext to any log capturing stdout.
 */
describe("seed never logs the seeded password", () => {
  const source = readFileSync("prisma/seed.ts", "utf8");

  it("does not print the literal seed password", () => {
    const loggedPassword = source
      .split("\n")
      .some((line) => line.includes("console.log") && line.includes("password123"));
    expect(loggedPassword).toBe(false);
  });

  it("does not print a 'Test Credentials' banner", () => {
    expect(source).not.toMatch(/test credentials/i);
  });
});
