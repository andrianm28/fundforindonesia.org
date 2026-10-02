import { randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import bcryptjs from "bcryptjs";
import { hashPassword, verifyPassword } from "@/lib/password-hash";
import { isHashAtCurrentCost } from "@/lib/password-hash-cost";

// Real bindings on both sides, no mocks. Stored hashes were written by
// bcryptjs; the native binding (ADR 0019) must read every one of them, and
// bcryptjs must still read what the binding writes (rollback path). A low cost
// keeps most of this fast; the format is identical at every cost.
const COST = 4;

// Test secrets are generated per run rather than written as literals: nothing
// here is a real credential, and a literal would read as one to secret scanners.
const secret = (prefix = "") => prefix + randomBytes(9).toString("hex");

describe("native bcrypt binding stays compatible with bcryptjs (ADR 0019)", () => {
  it("verifies a hash written by bcryptjs and rejects a wrong password", async () => {
    const right = secret();
    const stored = await bcryptjs.hash(right, COST);
    expect(stored).toMatch(/^\$2[ab]\$04\$/);

    expect(await verifyPassword(right, stored)).toBe(true);
    expect(await verifyPassword(secret(), stored)).toBe(false);
  });

  it("verifies the $2a$ and $2b$ spellings of the same hash", async () => {
    const pw = secret();
    const stored = await bcryptjs.hash(pw, COST);
    const asB = "$2b$" + stored.slice(4);
    const asA = "$2a$" + stored.slice(4);

    expect(await verifyPassword(pw, asB)).toBe(true);
    expect(await verifyPassword(pw, asA)).toBe(true);
  });

  it("writes hashes bcryptjs can verify, at the cost asked for", async () => {
    const pw = secret();
    const stored = await hashPassword(pw, COST);

    expect(stored).toMatch(/^\$2[ab]\$04\$.{53}$/);
    expect(await bcryptjs.compare(pw, stored)).toBe(true);
    expect(await bcryptjs.compare(secret(), stored)).toBe(false);
    expect(bcryptjs.getRounds(stored)).toBe(COST);
  });

  it("keeps cost-12 hashes (the production factor) readable both ways", async () => {
    const pw = secret();
    const fromJs = await bcryptjs.hash(pw, 12);
    const fromNative = await hashPassword(pw, 12);

    expect(await verifyPassword(pw, fromJs)).toBe(true);
    expect(await bcryptjs.compare(pw, fromNative)).toBe(true);
    expect(isHashAtCurrentCost(fromJs)).toBe(true);
    expect(isHashAtCurrentCost(fromNative)).toBe(true);
  }, 30_000);

  it("reads the cost off the prefix", async () => {
    const weak = await bcryptjs.hash(secret(), COST);
    expect(isHashAtCurrentCost(weak)).toBe(false);
    expect(isHashAtCurrentCost("")).toBe(false);
    expect(isHashAtCurrentCost("not-a-bcrypt-hash")).toBe(false);
    expect(isHashAtCurrentCost("$2a$1$short")).toBe(false);
  });

  it("returns false, rather than throwing, for a stored value that is not a bcrypt hash", async () => {
    expect(await verifyPassword(secret(), secret("not-a-hash-"))).toBe(false);
    expect(await verifyPassword(secret(), "")).toBe(false);
  });

  it("verifies a $2y$ hash (PHP spelling) of the same digest", async () => {
    const pw = secret();
    const stored = await bcryptjs.hash(pw, COST);
    const asY = "$2y$" + stored.slice(4);

    expect(await verifyPassword(pw, asY)).toBe(true);
    expect(await verifyPassword(secret(), asY)).toBe(false);
  });

  it("agrees with bcryptjs on passwords longer than 72 bytes (bcrypt ignores the tail; the schema rejects them earlier)", async () => {
    const head = secret().repeat(4); // 72 hex chars = exactly 72 bytes
    expect(Buffer.byteLength(head)).toBe(72);
    const long = head + secret();
    const fromJs = await bcryptjs.hash(long, COST);
    const fromNative = await hashPassword(long, COST);

    // Both implementations ignore everything past byte 72, in both directions.
    expect(await verifyPassword(long, fromJs)).toBe(true);
    expect(await verifyPassword(head, fromJs)).toBe(true);
    expect(await bcryptjs.compare(head, fromNative)).toBe(true);
    expect(await bcryptjs.compare(long, fromNative)).toBe(true);
  });

  it("handles a password containing a NUL byte the way bcryptjs does", async () => {
    const pw = secret() + "\0" + secret();
    const fromJs = await bcryptjs.hash(pw, COST);
    const fromNative = await hashPassword(pw, COST);

    // Never throws; whichever way the binding treats NUL, hashes written by
    // either side must verify identically under the other.
    expect(await verifyPassword(pw, fromJs)).toBe(await bcryptjs.compare(pw, fromJs));
    expect(await bcryptjs.compare(pw, fromNative)).toBe(await verifyPassword(pw, fromNative));
    expect(await verifyPassword(secret(), fromNative)).toBe(false);
  });
});
