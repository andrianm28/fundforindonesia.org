import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { lookupUserEmail, sealUserEmail } from "@/lib/contact-fields";

const mockFindUnique = prisma.user.findUnique as unknown as Mock;
const mockFindFirst = prisma.user.findFirst as unknown as Mock;

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
