import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

// Real bcryptjs, deliberately. The defect these tests guard is a *number* — the
// cost factor that bcrypt writes into the hash's own `$2a$NN$` prefix — so a
// mocked bcrypt cannot see it and would pass on the broken code. The price is
// that hashing runs at the production factor, hence the generous timeouts.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      // The register route's duplicate check goes through the lookup HMAC
      // rather than a `findUnique` on the plaintext address (ADR 0012), so
      // `findFirst` is the call it makes and this mock has to have it.
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { POST as register } from "@/app/api/auth/register/route";
import { PATCH as changePassword } from "@/app/api/user/password/route";
import { PASSWORD_HASH_COST, isHashAtCurrentCost } from "@/lib/password-hash-cost";

const mockedUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockedUserFindFirst = vi.mocked(prisma.user.findFirst);
const mockedUserCreate = vi.mocked(prisma.user.create);
const mockedUserUpdate = vi.mocked(prisma.user.update);
const mockedGetServerSession = vi.mocked(getServerSession);

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The hash the register route would have stored for this account. */
async function registerHashFor(password: string): Promise<string> {
  // No account on that address yet: the register route's duplicate check reads
  // it through the lookup HMAC (ADR 0012).
  mockedUserFindFirst.mockResolvedValue(null);
  mockedUserCreate.mockResolvedValue({ id: "user-1" } as never);

  const response = await register(
    post("/api/auth/register", {
      name: "Test",
      email: "test@test.com",
      password,
    })
  );

  expect(response.status).toBe(201);
  return vi.mocked(prisma.user.create).mock.calls[0][0].data
    .password as string;
}

describe("the single password cost factor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The defect, stated as a property of the stored hash rather than as a
  // number: rotating a password may leave the account exactly as strong as it
  // was, never weaker. Before the fix this compared 10 against 12 and failed.
  it("a password change does not lower the cost factor the account registered with", async () => {
    const registeredHash = await registerHashFor("original-password-123");

    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as never);
    mockedUserFindUnique.mockResolvedValue({
      id: "user-1",
      password: registeredHash,
    } as never);
    mockedUserUpdate.mockResolvedValue({} as never);

    const response = await changePassword(
      patch("/api/user/password", {
        currentPassword: "original-password-123",
        newPassword: "rotated-password-456",
        confirmPassword: "rotated-password-456",
      })
    );

    expect(response.status).toBe(200);

    const storedAfterChange = vi.mocked(prisma.user.update).mock.calls[0][0]
      .data.password as string;

    expect(bcrypt.getRounds(storedAfterChange)).toBe(
      bcrypt.getRounds(registeredHash)
    );
  }, 30_000);

  it("registration and a password change both hash at that one factor", async () => {
    const registeredHash = await registerHashFor("original-password-123");

    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as never);
    mockedUserFindUnique.mockResolvedValue({
      id: "user-1",
      password: registeredHash,
    } as never);
    mockedUserUpdate.mockResolvedValue({} as never);

    const response = await changePassword(
      patch("/api/user/password", {
        currentPassword: "original-password-123",
        newPassword: "rotated-password-456",
        confirmPassword: "rotated-password-456",
      })
    );

    expect(response.status).toBe(200);
    const storedAfterChange = vi.mocked(prisma.user.update).mock.calls[0][0]
      .data.password as string;

    expect(bcrypt.getRounds(registeredHash)).toBe(PASSWORD_HASH_COST);
    expect(bcrypt.getRounds(storedAfterChange)).toBe(PASSWORD_HASH_COST);
  }, 30_000);

  it("a password change still stores a hash that verifies the new password", async () => {
    const registeredHash = await registerHashFor("original-password-123");

    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as never);
    mockedUserFindUnique.mockResolvedValue({
      id: "user-1",
      password: registeredHash,
    } as never);
    mockedUserUpdate.mockResolvedValue({} as never);

    await changePassword(
      patch("/api/user/password", {
        currentPassword: "original-password-123",
        newPassword: "rotated-password-456",
        confirmPassword: "rotated-password-456",
      })
    );

    const storedAfterChange = vi.mocked(prisma.user.update).mock.calls[0][0]
      .data.password as string;

    expect(await bcrypt.compare("rotated-password-456", storedAfterChange)).toBe(
      true
    );
  }, 30_000);
});

describe("reading the cost factor back off a stored hash", () => {
  // The cost is read out of the hash's own prefix, so an account weakened by
  // an older password change is recognisable without a second column to keep
  // in sync and without a migration.
  it("reports a hash at the current factor as current, and a weaker one as not", async () => {
    const atCurrentCost = await bcrypt.hash("correct-horse-123", PASSWORD_HASH_COST);
    const weakened = await bcrypt.hash("correct-horse-123", 4);

    expect(isHashAtCurrentCost(atCurrentCost)).toBe(true);
    expect(isHashAtCurrentCost(weakened)).toBe(false);
  }, 30_000);

  it("reports a hash it cannot read a factor out of as not current, so it gets replaced", () => {
    expect(isHashAtCurrentCost("")).toBe(false);
    expect(isHashAtCurrentCost("not-a-bcrypt-hash")).toBe(false);
  });
});
