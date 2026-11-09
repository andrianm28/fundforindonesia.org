// @vitest-environment node
import { createHmac, hkdfSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintMfaProof, readMfaProof } from "./mfa-proof";

const now = Date.UTC(2026, 10, 9, 12);
const claim = { userId: "u1", sid: "s1" };

describe("mfa proof", () => {
  beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", "test-secret-one"));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips the enrolment it was minted for", () => {
    const proof = mintMfaProof({ ...claim, enabledAtMs: 123 }, now);
    expect(readMfaProof(proof, claim, now + 1000)).toBe(123);
  });

  it("is refused for another user or another session", () => {
    const proof = mintMfaProof({ ...claim, enabledAtMs: 123 }, now);
    expect(readMfaProof(proof, { userId: "u2", sid: "s1" }, now)).toBeNull();
    expect(readMfaProof(proof, { userId: "u1", sid: "s2" }, now)).toBeNull();
  });

  it("expires after two minutes", () => {
    const proof = mintMfaProof({ ...claim, enabledAtMs: 123 }, now);
    expect(readMfaProof(proof, claim, now + 119_000)).toBe(123);
    expect(readMfaProof(proof, claim, now + 121_000)).toBeNull();
  });

  it("is refused when the payload is altered", () => {
    const proof = mintMfaProof({ ...claim, enabledAtMs: 123 }, now);
    const [payload, sig] = proof.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "u1", s: "s1", e: 999, x: now + 60_000 })).toString("base64url");
    expect(readMfaProof(`${forged}.${sig}`, claim, now)).toBeNull();
    expect(readMfaProof(`${payload}.AAAA`, claim, now)).toBeNull();
  });

  it("is refused under a different secret", () => {
    const proof = mintMfaProof({ ...claim, enabledAtMs: 123 }, now);
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret-two");
    expect(readMfaProof(proof, claim, now)).toBeNull();
  });

  it("is refused when malformed, or not a string", () => {
    for (const bad of ["", "x", "a.b.c", undefined, null, 5, {}]) {
      expect(readMfaProof(bad, claim, now)).toBeNull();
    }
  });

  it("will not mint without a secret", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(() => mintMfaProof({ ...claim, enabledAtMs: 1 }, now)).toThrow();
  });

  it("is signed with a key derived by HKDF from NEXTAUTH_SECRET, never the raw secret", () => {
    const proof = mintMfaProof({ ...claim, enabledAtMs: 123 }, now);
    const [payload, mac] = proof.split(".");
    const message = `mfa-proof|${payload}`;
    const derived = Buffer.from(hkdfSync("sha256", "test-secret-one", Buffer.alloc(0), "ffi-mfa-proof", 32));
    expect(createHmac("sha256", derived).update(message).digest("base64url")).toBe(mac);
    expect(createHmac("sha256", "test-secret-one").update(message).digest("base64url")).not.toBe(mac);
  });
});
