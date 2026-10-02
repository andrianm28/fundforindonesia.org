import { describe, it, expect, vi, beforeEach } from "vitest";

// The binding is mocked here only to force its error paths; real hashes are
// exercised in password-hash.test.ts.
const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@node-rs/bcrypt", () => ({ hash: vi.fn(), verify }));

import { verifyPassword } from "@/lib/password-hash";

describe("verifyPassword error handling (ADR 0019)", () => {
  beforeEach(() => {
    verify.mockReset();
  });

  it("returns false when the binding rejects the stored value as an invalid hash", async () => {
    verify.mockImplementation(async () => { throw new Error("Invalid hash format"); });
    expect(await verifyPassword("pw", "not-a-hash")).toBe(false);
  });

  it("throws when the binding itself fails to load", async () => {
    const loadFailure = new Error("Cannot find native binding");
    verify.mockImplementation(async () => { throw loadFailure; });
    await expect(verifyPassword("pw", "$2b$04$" + "a".repeat(53))).rejects.toBe(loadFailure);
  });

  it("throws on an unexpected synchronous error too", async () => {
    verify.mockImplementation(() => {
      throw new TypeError("boom");
    });
    await expect(verifyPassword("pw", "x")).rejects.toThrow("boom");
  });
});
