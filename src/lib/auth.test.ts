import { createRequire } from "node:module";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

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

describe("authOptions.callbacks.session", () => {
  it("copies the token's assignments onto session.user.assignments", async () => {
    const session = await authOptions.callbacks!.session!({
      session: { user: {}, expires: "2099-01-01" } as any,
      token: { id: "user-1", assignments: ["ADMIN", "VERIFIER"] } as any,
      newSession: undefined,
      trigger: "update",
    } as any);

    expect(session.user.assignments).toEqual(["ADMIN", "VERIFIER"]);
  });

  it("defaults assignments to an empty array when the token has none", async () => {
    const session = await authOptions.callbacks!.session!({
      session: { user: {}, expires: "2099-01-01" } as any,
      token: { id: "user-2" } as any,
      newSession: undefined,
      trigger: "update",
    } as any);

    expect(session.user.assignments).toEqual([]);
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

// Ticket 47: signing in again with a different picture updates the stored one,
// and the token (so the session) carries the new one.
describe("authOptions.callbacks.jwt on an OAuth sign-in", () => {
  type JwtArgs = Parameters<NonNullable<typeof authOptions.callbacks>["jwt"] & object>[0];

  const signIn = (stored: string | null, picture: unknown) => {
    const args = {
      token: { picture: stored },
      user: { id: "user-1", email: "andi@email.com", image: stored },
      account: { type: "oauth", provider: "google", providerAccountId: "g-1" },
      profile: { sub: "g-1", picture },
      trigger: "signIn",
    } as unknown as JwtArgs;
    return authOptions.callbacks!.jwt!(args);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ assignments: [] });
    // The write goes through the adapter, which hands the row back with its
    // address decrypted, so the double returns a sealed row the way Prisma does.
    mockUpdate.mockResolvedValue({ id: "user-1", name: "Andi", ...sealUserEmail("andi@email.com") });
  });

  it("writes the picture through the adapter's updateUser, not straight to the table", async () => {
    const updateUser = vi.spyOn(authOptions.adapter!, "updateUser");

    await signIn("https://lh3.googleusercontent.com/old.png", "https://lh3.googleusercontent.com/new.png");

    expect(updateUser).toHaveBeenCalledWith({ id: "user-1", image: "https://lh3.googleusercontent.com/new.png" });
    updateUser.mockRestore();
  });

  it("stores a different provider picture and puts it on the token", async () => {
    const token = await signIn("https://lh3.googleusercontent.com/old.png", "https://lh3.googleusercontent.com/new.png");

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { avatar: "https://lh3.googleusercontent.com/new.png" },
    });
    expect(token.picture).toBe("https://lh3.googleusercontent.com/new.png");
  });

  it("stores the provider picture for an account that had none", async () => {
    await signIn(null, "https://lh3.googleusercontent.com/new.png");

    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("writes nothing when the picture is unchanged, or the provider sent none", async () => {
    await signIn("https://lh3.googleusercontent.com/same.png", "https://lh3.googleusercontent.com/same.png");
    await signIn("https://lh3.googleusercontent.com/same.png", undefined);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not overwrite a picture the user uploaded here", async () => {
    const token = await signIn("/uploads/me.jpg", "https://lh3.googleusercontent.com/new.png");

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(token.picture).toBe("/uploads/me.jpg");
  });

  it("still signs in when the write fails, and logs only the message", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("db down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const token = await signIn("https://lh3.googleusercontent.com/old.png", "https://lh3.googleusercontent.com/new.png");

    expect(token.picture).toBe("https://lh3.googleusercontent.com/old.png");
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]!.some((arg) => arg instanceof Error)).toBe(false);
    expect(logged.mock.calls[0]).toContain("db down");
    logged.mockRestore();
  });

  it("adds only id, picture and assignments to what next-auth already put on the token", async () => {
    const seeded = { name: "Andi", email: "andi@email.com", sub: "g-1", picture: "https://lh3.googleusercontent.com/old.png" };
    const args = {
      token: { ...seeded },
      user: { id: "user-1", email: "andi@email.com", image: seeded.picture },
      account: { type: "oauth", provider: "google", providerAccountId: "g-1" },
      profile: { sub: "g-1", picture: "https://lh3.googleusercontent.com/new" },
      trigger: "signIn",
    } as unknown as JwtArgs;

    const token = await authOptions.callbacks!.jwt!(args);

    expect(token).toEqual({
      ...seeded,
      id: "user-1",
      picture: "https://lh3.googleusercontent.com/new",
      assignments: [],
    });
  });

  it("writes no avatar for a Credentials login, whatever the profile says", async () => {
    const token = await authOptions.callbacks!.jwt!({
      token: { picture: null },
      user: { id: "user-1", email: "andi@email.com", image: null },
      account: { type: "credentials", provider: "credentials", providerAccountId: "user-1" },
      profile: { picture: "https://lh3.googleusercontent.com/new" },
      trigger: "signIn",
    } as unknown as JwtArgs);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(token.picture).toBeNull();
  });

  it.each([
    ["http:", "http://lh3.googleusercontent.com/a"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["a host outside googleusercontent.com", "https://evil.example/a.png"],
    ["a look-alike host", "https://googleusercontent.com.evil.example/a.png"],
    ["a bare googleusercontent.com", "https://googleusercontent.com/a.png"],
    ["a non-string", 42],
  ])("rejects a provider picture that is %s", async (_label, picture) => {
    const token = await signIn(null, picture);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(token.picture).toBeNull();
  });

  it("accepts an https picture on a googleusercontent.com subdomain", async () => {
    await signIn(null, "https://lh3.googleusercontent.com/a/abc=s96-c");

    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("overwrites a stored picture only when it is a remote provider one", async () => {
    await signIn("http://old.example/a.png", "https://lh3.googleusercontent.com/a");
    expect(mockUpdate).not.toHaveBeenCalled();
    await signIn("https://lh3.googleusercontent.com/old", "https://lh3.googleusercontent.com/a");
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

// Ticket 47: the picture reaches `session.user.image`. next-auth's own session
// route seeds `session.user.image` from `token.picture` and then hands the
// session to our `session` callback, so the real route is driven here with the
// real callbacks; the callback must not drop what the route put there.
describe("session.user.image", () => {
  // Not an exported entry point of next-auth, so it is loaded by path, the way
  // src/lib/auth-adapter.test.ts loads the callback handler.
  const nodeRequire = createRequire(import.meta.url);
  const { default: sessionRoute } = nodeRequire(
    path.join(path.dirname(nodeRequire.resolve("next-auth")), "core", "routes", "session.js"),
  ) as { default: (params: Record<string, unknown>) => Promise<{ body: unknown }> };

  async function sessionFor(token: Record<string, unknown>) {
    const response = await sessionRoute({
      options: {
        adapter: undefined,
        jwt: { decode: async () => token, encode: async () => "encoded" },
        events: {},
        callbacks: authOptions.callbacks,
        logger: { error: () => {}, warn: () => {}, debug: () => {} },
        session: { strategy: "jwt", maxAge: 60 },
      },
      sessionStore: { value: "cookie", chunk: () => [] },
      isUpdate: false,
    });
    return response.body as { user?: { image?: string | null; id?: string } };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ assignments: [] });
  });

  it("is filled from the token's picture", async () => {
    const body = await sessionFor({ id: "user-1", picture: "https://lh3.googleusercontent.com/a/new" });

    expect(body.user?.image).toBe("https://lh3.googleusercontent.com/a/new");
    expect(body.user?.id).toBe("user-1");
  });

  it("is empty, not a broken value, when the token has no picture", async () => {
    const body = await sessionFor({ id: "user-1", picture: null });

    expect(body.user?.image ?? null).toBeNull();
  });
});
