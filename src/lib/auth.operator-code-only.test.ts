import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

/**
 * Admin and Verifier sign in only by mailed code (owner, 9 Nov 2026: the email
 * code replaces MFA for operators, PKS Pasal 8(1); ADR 0026). Google would
 * walk around it, so it is refused for an account that holds any Assignment.
 * Passwords are gone for everyone (owner, 9 Nov 2026).
 */

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: vi.fn() }));

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";

const findUnique = prisma.user.findUnique as unknown as Mock;

beforeEach(() => {
  vi.resetAllMocks();
  (consumeRateLimit as unknown as Mock).mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 60 });
});

describe("Google sign-in for operators", () => {
  const signIn = (provider: string) =>
    authOptions.callbacks!.signIn!({
      user: { id: "user-1", email: "sari@example.test" },
      account: { provider, type: provider === "google" ? "oauth" : "credentials", providerAccountId: "x" },
    } as never);

  it("refuses an existing account that holds an Assignment", async () => {
    findUnique.mockResolvedValue({ assignments: [{ assignment: "ADMIN" }] });
    expect(await signIn("google")).toBe("/login?error=OperatorCodeOnly");
  });

  it("lets an account with no Assignment, or a new one, through", async () => {
    findUnique.mockResolvedValue({ assignments: [] });
    expect(await signIn("google")).toBe(true);
    findUnique.mockResolvedValue(null);
    expect(await signIn("google")).toBe(true);
  });

  it("does not touch the code sign-in, which checks for itself", async () => {
    expect(await signIn("email-otp")).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("operator authority on a live session", () => {
  const jwt = (token: Record<string, unknown>, signIn?: { provider: string }) =>
    authOptions.callbacks!.jwt!({
      token,
      user: signIn ? { id: "user-1", email: "sari@example.test" } : undefined,
      account: signIn ? { provider: signIn.provider, type: "credentials", providerAccountId: "user-1" } : null,
      profile: undefined,
      trigger: signIn ? "signIn" : undefined,
    } as never);

  beforeEach(() => {
    findUnique.mockResolvedValue({ password: null, assignments: [{ assignment: "ADMIN" }] });
  });

  it("records how the session was signed in", async () => {
    expect((await jwt({}, { provider: "email-otp" })).amr).toBe("email-otp");
    expect((await jwt({}, { provider: "google" })).amr).toBe("google");
  });

  it("grants an Assignment only to a session signed in by code", async () => {
    expect((await jwt({}, { provider: "email-otp" })).assignments).toEqual(["ADMIN"]);
  });

  it("gives no authority to a session left from the retired password sign-in, even after an Assignment is granted", async () => {
    const token = await jwt({ id: "user-1", amr: "credentials" });
    expect(token.id).toBe("user-1");
    expect(token.assignments).toEqual([]);
  });

  it("gives no authority to a session from before this rule (no sign-in method recorded)", async () => {
    expect((await jwt({ id: "user-1" })).assignments).toEqual([]);
  });

  it("gives no authority to a Google session", async () => {
    expect((await jwt({ id: "user-1", amr: "google" })).assignments).toEqual([]);
  });
});
