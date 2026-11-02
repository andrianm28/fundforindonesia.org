import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

/**
 * Sign-in with a mailed code (login OTP): the `email-otp` provider hands the
 * address and code to src/lib/login-code.ts and signs in whoever it returns.
 * Attempts are counted per client + address before anything else, like the
 * password login, so guessing across many fresh codes is bounded too.
 */

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("@/lib/login-code", () => ({ verifyLoginCode: vi.fn() }));

import type { CredentialsConfig } from "next-auth/providers/credentials";
import { authOptions } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { verifyLoginCode } from "@/lib/login-code";

const consume = consumeRateLimit as unknown as Mock;
const verify = verifyLoginCode as unknown as Mock;

async function signIn(credentials: Record<string, string>, forwardedFor = "203.0.113.9") {
  // next-auth keeps a Credentials provider's own `id` under `options` until it
  // merges them at runtime, so the top-level `id` of both is "credentials".
  const provider = authOptions.providers.find(
    (p): p is CredentialsConfig => (p as CredentialsConfig).options?.id === "email-otp",
  );
  if (!provider?.options) throw new Error("the email-otp provider is missing from authOptions");
  return provider.options.authorize(credentials, {
    headers: { "x-forwarded-for": forwardedFor },
    body: {},
    query: {},
    method: "POST",
  });
}

const USER = { id: "user-1", email: "sari@example.test", name: "Sari", image: null };

beforeEach(() => {
  vi.resetAllMocks();
  consume.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 60 });
});

describe("email-otp provider", () => {
  it("signs in the account the code belongs to", async () => {
    verify.mockResolvedValue(USER);

    expect(await signIn({ email: "sari@example.test", code: "123456" })).toEqual(USER);
    expect(verify).toHaveBeenCalledWith("sari@example.test", "123456");
  });

  it("refuses a code that does not verify, with one message for every reason", async () => {
    verify.mockResolvedValue(null);

    await expect(signIn({ email: "sari@example.test", code: "000000" })).rejects.toThrow(
      "Kode salah atau sudah tidak berlaku",
    );
  });

  it("refuses an empty field before counting or checking", async () => {
    await expect(signIn({ email: "", code: "123456" })).rejects.toThrow();
    await expect(signIn({ email: "sari@example.test", code: "" })).rejects.toThrow();
    expect(verify).not.toHaveBeenCalled();
  });

  it("counts per client + address and per client before checking", async () => {
    verify.mockResolvedValue(USER);

    await signIn({ email: " Sari@Example.test ", code: "123456" });

    expect(consume.mock.calls.map((c) => [c[1].scope, c[1].subject])).toEqual([
      ["auth-login-code", "203.0.113.9|sari@example.test"],
      ["auth-login-code-client", "203.0.113.9"],
    ]);
  });

  it("refuses once limited, without checking the code", async () => {
    consume.mockResolvedValue({ allowed: false, count: 11, retryAfterSeconds: 60 });

    await expect(signIn({ email: "sari@example.test", code: "123456" })).rejects.toThrow(/Terlalu banyak/);
    expect(verify).not.toHaveBeenCalled();
  });
});
