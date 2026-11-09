import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

/**
 * Admin and Verifier sign in only by mailed code (owner, 9 Nov 2026: the email
 * code replaces MFA for operators, PKS Pasal 8(1); ADR 0026). A password or a
 * Google sign-in would walk around it, so both are refused for an account that
 * holds any Assignment. Everyone else keeps the password fallback.
 */

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("@/lib/password-hash", () => ({ verifyPassword: vi.fn(), hashPassword: vi.fn() }));

import type { CredentialsConfig } from "next-auth/providers/credentials";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { verifyPassword } from "@/lib/password-hash";
import { PASSWORD_HASH_COST } from "@/lib/password-hash-cost";
import { sealUserEmail } from "@/lib/contact-fields";

const findFirst = prisma.user.findFirst as unknown as Mock;
const findUnique = prisma.user.findUnique as unknown as Mock;
const verify = verifyPassword as unknown as Mock;
const HASH = `$2b$${PASSWORD_HASH_COST}$` + "x".repeat(53);

function passwordLogin(email: string, password: string) {
  const provider = authOptions.providers.find((p): p is CredentialsConfig => p.id === "credentials");
  return provider!.options.authorize({ email, password }, {});
}

function row(assignments: string[]) {
  return {
    id: "user-1",
    name: "Sari",
    avatar: null,
    password: HASH,
    assignments: assignments.map((assignment) => ({ assignment })),
    ...sealUserEmail("sari@example.test"),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (consumeRateLimit as unknown as Mock).mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 60 });
  verify.mockResolvedValue(true);
});

describe("password sign-in for operators", () => {
  it("refuses an Admin with the right password and points to the code", async () => {
    findFirst.mockResolvedValue(row(["ADMIN"]));
    await expect(passwordLogin("sari@example.test", "right")).rejects.toThrow(/kode email/i);
  });

  it("refuses a Verifier the same way", async () => {
    findFirst.mockResolvedValue(row(["VERIFIER"]));
    await expect(passwordLogin("sari@example.test", "right")).rejects.toThrow(/kode email/i);
  });

  it("says nothing about the role to someone with a wrong password", async () => {
    findFirst.mockResolvedValue(row(["ADMIN"]));
    verify.mockResolvedValue(false);
    await expect(passwordLogin("sari@example.test", "wrong")).rejects.toThrow("Email atau password salah");
  });

  it("still signs in an account with no Assignment", async () => {
    findFirst.mockResolvedValue(row([]));
    expect(await passwordLogin("sari@example.test", "right")).toMatchObject({ id: "user-1" });
  });

  it("asks for the assignments in the same lookup", async () => {
    findFirst.mockResolvedValue(row([]));
    await passwordLogin("sari@example.test", "right");
    expect(findFirst.mock.calls[0][0].select.assignments).toEqual({ select: { assignment: true } });
  });
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

  it("does not touch the code or password sign-ins, which check for themselves", async () => {
    expect(await signIn("email-otp")).toBe(true);
    expect(await signIn("credentials")).toBe(true);
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
    expect((await jwt({}, { provider: "credentials" })).amr).toBe("credentials");
  });

  it("grants an Assignment only to a session signed in by code", async () => {
    expect((await jwt({}, { provider: "email-otp" })).assignments).toEqual(["ADMIN"]);
  });

  it("gives no authority to a password session whose account was granted an Assignment later", async () => {
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
