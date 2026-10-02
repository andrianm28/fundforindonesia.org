import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { DefaultSession, Session } from "next-auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// The credentials login is exercised through the module under test, so bcrypt
// is stubbed here rather than run at the production cost factor. The factor
// itself is verified against real bcryptjs in
// `src/__tests__/integration/password-hash-cost.test.ts`.
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
    getRounds: vi.fn(),
  },
}));

import bcrypt from "bcryptjs";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { PASSWORD_HASH_COST } from "@/lib/password-hash-cost";
import { lookupUserEmail, sealUserEmail } from "@/lib/contact-fields";

const mockFindUnique = prisma.user.findUnique as unknown as Mock;
const mockFindFirst = prisma.user.findFirst as unknown as Mock;
const mockUpdate = prisma.user.update as unknown as Mock;
const mockCompare = bcrypt.compare as unknown as Mock;
const mockHash = bcrypt.hash as unknown as Mock;
const mockGetRounds = bcrypt.getRounds as unknown as Mock;

/**
 * The credentials provider's `authorize`, which is where login lives.
 *
 * next-auth's provider wrapper puts the call we wrote under `options` and
 * leaves a stub returning null at the top level, so this reaches into
 * `options`. That is the only way to drive the real function; the alternative
 * is to log in over HTTP, which no unit test in this repo does.
 */
async function login(credentials: { email: string; password: string }) {
  const provider = authOptions.providers.find(
    (p): p is CredentialsConfig => p.id === "credentials"
  );
  if (!provider?.options) {
    throw new Error("the credentials provider is missing from authOptions");
  }
  // The request argument is unused by our `authorize`, and every field of the
  // shape next-auth asks for is optional.
  return provider.options.authorize(credentials, {});
}

// The adapter the app installs. This is the wiring only -- src/lib/auth-adapter.test.ts
// drives the real adapter and next-auth's own sign-in step, which is where the
// row it finds here actually comes from.
describe("authOptions.adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds a Donor by their sealed address, and asks for no column that is gone", async () => {
    // A row as Prisma returns it: sealed, with no `email` -- the shape on which
    // the adapter's own lookup threw on a Google sign-in.
    mockFindFirst.mockResolvedValue({ id: "user-9", name: "Andi", ...sealUserEmail("Andi@Email.com") });

    const found = await authOptions.adapter!.getUserByEmail!("Andi@Email.com");

    expect(mockFindFirst).toHaveBeenCalledWith({ where: lookupUserEmail("Andi@Email.com") });
    expect(mockFindUnique).not.toHaveBeenCalled();
    // The address comes back decrypted, because it is what next-auth puts on
    // the token and what the AppShell and the account page render.
    expect(found?.email).toBe("Andi@Email.com");
  });

  it("returns nothing for an address with no account, rather than throwing", async () => {
    mockFindFirst.mockResolvedValue(null);

    expect(await authOptions.adapter!.getUserByEmail!("nobody@email.com")).toBeNull();
  });
});

describe("authOptions.callbacks.jwt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("carries the user's current assignments onto the token", async () => {
    mockFindUnique.mockResolvedValue({
      assignments: [{ assignment: "VERIFIER" }, { assignment: "ADMIN" }],
    });

    const token = await authOptions.callbacks!.jwt!({
      token: { id: "user-1" } as any,
      user: undefined as any,
      account: null,
      profile: undefined,
      trigger: undefined,
    } as any);

    expect(token.assignments).toEqual(["VERIFIER", "ADMIN"]);
  });

  it("gives a user with no assignment rows an empty array, not undefined", async () => {
    mockFindUnique.mockResolvedValue({
      assignments: [],
    });

    const token = await authOptions.callbacks!.jwt!({
      token: { id: "user-2" } as any,
      user: undefined as any,
      account: null,
      profile: undefined,
      trigger: undefined,
    } as any);

    expect(token.assignments).toEqual([]);
  });

  // The Role hierarchy and the self-claimed verification are retired
  // (retire-role-hierarchy): the token carries assignments, and only them.
  it("reads only the assignments, once, and puts no Role or self-claimed verification on the token", async () => {
    mockFindUnique.mockResolvedValue({
      assignments: [{ assignment: "VERIFIER" }],
    });

    const token = await authOptions.callbacks!.jwt!({
      token: { id: "user-3" } as any,
      user: undefined as any,
      account: null,
      profile: undefined,
      trigger: undefined,
    } as any);

    expect(mockFindUnique).toHaveBeenCalledOnce();
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "user-3" },
      select: { assignments: { select: { assignment: true } } },
    });
    expect(Object.keys(token).sort()).toEqual(["assignments", "id"]);
  });
});

// `callbacks.session` is typed to return `Session | DefaultSession`, and only
// `Session.user` carries `assignments` (and is non-optional). Narrow with the
// `in` operator instead of casting: if the callback ever drops `user` or the
// field, this throws and the test fails rather than the type being silenced.
function assignmentsOf(session: Session | DefaultSession): unknown {
  const user = session.user;
  if (!user || !("assignments" in user)) {
    throw new Error("session.user.assignments is missing");
  }
  return user.assignments;
}

describe("authOptions.callbacks.session", () => {
  it("copies the token's assignments onto session.user.assignments", async () => {
    const session = await authOptions.callbacks!.session!({
      session: { user: {}, expires: "2099-01-01" } as any,
      token: { id: "user-1", assignments: ["ADMIN", "VERIFIER"] } as any,
      newSession: undefined,
      trigger: "update",
    } as any);

    expect(assignmentsOf(session)).toEqual(["ADMIN", "VERIFIER"]);
  });

  it("defaults assignments to an empty array when the token has none", async () => {
    const session = await authOptions.callbacks!.session!({
      session: { user: {}, expires: "2099-01-01" } as any,
      token: { id: "user-2" } as any,
      newSession: undefined,
      trigger: "update",
    } as any);

    expect(assignmentsOf(session)).toEqual([]);
  });

  // A token issued before the Role was retired still carries these fields
  // until it is refreshed; the session must not pass them on.
  it("passes no Role or self-claimed verification on from an old token", async () => {
    const session = await authOptions.callbacks!.session!({
      session: { user: {}, expires: "2099-01-01" } as any,
      token: { id: "user-4", role: "ADMIN", isVerified: true, verificationType: "ktp", assignments: [] } as any,
      newSession: undefined,
      trigger: "update",
    } as any);

    expect(Object.keys(session.user!).sort()).toEqual(["assignments", "id"]);
  });
});

describe("credentials login", () => {
  // A row as `authorize` selects it: the sealed columns, no plaintext `email`
  // (ADR 0012), and the lookup is the HMAC rather than a `findUnique` on the
  // address -- see src/lib/auth-adapter.test.ts for the real adapter.
  const storedUser = {
    id: "user-1",
    name: "Test",
    avatar: null,
    password: "$2a$10$weakened",
    ...sealUserEmail("test@test.com"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockResolvedValue(storedUser);
    mockCompare.mockResolvedValue(true);
  });

  it("returns the user on a correct password", async () => {
    mockGetRounds.mockReturnValue(PASSWORD_HASH_COST);

    const result = await login({ email: "test@test.com", password: "secret123" });

    expect(result).toMatchObject({ id: "user-1", email: "test@test.com" });
  });

  it("rejects a wrong password", async () => {
    mockGetRounds.mockReturnValue(PASSWORD_HASH_COST);
    mockCompare.mockResolvedValue(false);

    await expect(
      login({ email: "test@test.com", password: "wrong" })
    ).rejects.toThrow("Email atau password salah");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // An account weakened by an older password change is repaired on the login
  // that proves the user knows the password, with nothing asked of them. The
  // cost is read off the stored hash's own prefix, so no second source of truth
  // has to be kept in sync and no row needs migrating.
  it("re-hashes at the current factor when the stored hash is weaker, without asking the user", async () => {
    mockGetRounds.mockReturnValue(PASSWORD_HASH_COST - 2);
    mockHash.mockResolvedValue("$2a$12$rehashed");

    const result = await login({
      email: "test@test.com",
      password: "secret123",
    });

    expect(mockHash).toHaveBeenCalledWith("secret123", PASSWORD_HASH_COST);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { password: "$2a$12$rehashed" },
    });
    // The user is signed in either way; the repair is not what gates the login.
    expect(result).toMatchObject({ id: "user-1" });
  });

  // The extra write is the cost of the repair, so it must be bounded: only when
  // the stored hash is actually below the current factor, so not on every login
  // and never on the request path.
  it("writes nothing when the stored hash is already at the current factor", async () => {
    mockGetRounds.mockReturnValue(PASSWORD_HASH_COST);

    await login({ email: "test@test.com", password: "secret123" });

    expect(mockHash).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("still signs the user in when the re-hash fails", async () => {
    mockGetRounds.mockReturnValue(PASSWORD_HASH_COST - 2);
    mockHash.mockRejectedValue(new Error("database unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await login({
      email: "test@test.com",
      password: "secret123",
    });

    expect(result).toMatchObject({ id: "user-1" });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("leaves a Google-only account (no password) alone", async () => {
    mockFindFirst.mockResolvedValue({ ...storedUser, password: null });

    await expect(
      login({ email: "test@test.com", password: "secret123" })
    ).rejects.toThrow("Email atau password salah");
    expect(mockHash).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
