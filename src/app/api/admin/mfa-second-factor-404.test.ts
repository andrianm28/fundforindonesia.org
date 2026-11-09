// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * pks-pemenuhan/03, the owner rule at the public seam: until the second factor
 * is satisfied, an ADMIN or VERIFIER holder gets a literal 404 from /admin,
 * /moderasi and their APIs, exactly as a non-holder does; once it is satisfied
 * they are served; resetting the factor closes the door again.
 *
 * Nothing between the cookie and the guards is stubbed except the database and
 * the cookie itself: `getServerSession` runs the REAL `jwt` and `session`
 * callbacks of `authOptions`, and the guards are the REAL admin and moderasi
 * routes and layouts.
 */

const db = vi.hoisted(() => ({
  assignments: [] as string[],
  enabledAt: null as Date | null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        password: "$2b$12$" + "a".repeat(53),
        assignments: db.assignments.map((assignment) => ({ assignment, assignedAt: new Date("2026-01-01") })),
        mfa: db.enabledAt ? { enabledAt: db.enabledAt } : null,
      })),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    bankAccountVerificationRequest: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("@/lib/password-hash", () => ({ verifyPassword: vi.fn(), hashPassword: vi.fn() }));
vi.mock("@/lib/bank-account-verification", () => ({ pendingBankAccountVerifications: vi.fn(async () => []) }));

const cookie = vi.hoisted(() => ({ token: null as Record<string, unknown> | null, trigger: undefined as string | undefined, update: undefined as unknown }));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getServerSession: async () => {
      if (!cookie.token) return null;
      const token = await actual.authOptions.callbacks!.jwt!({
        token: { ...cookie.token } as never,
        user: undefined as never,
        account: null,
        profile: undefined,
        trigger: cookie.trigger,
        session: cookie.update,
      } as never);
      return actual.authOptions.callbacks!.session!({
        session: { user: {}, expires: "2099-01-01" } as never,
        token,
        newSession: undefined,
        trigger: "update",
      } as never);
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { authOptions } from "@/lib/auth";
import { mintMfaProof } from "@/lib/mfa-proof";
import { GET as adminUsers } from "./users/route";
import { GET as moderasiQueue } from "../moderasi/bank-accounts/route";
import AdminLayout from "@/app/admin/layout";
import ModerasiLayout from "@/app/moderasi/layout";

const ENROLLED_AT = new Date("2026-11-01T00:00:00Z");
const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

/** A browser that just signed in: the token the jwt callback issues at sign-in. */
async function signIn() {
  const token = await authOptions.callbacks!.jwt!({
    token: {},
    user: { id: "u1" },
    account: null,
    profile: undefined,
    trigger: "signIn",
  } as never);
  cookie.token = { ...token };
  return token;
}

async function proveSecondFactor() {
  const proof = mintMfaProof({ userId: "u1", sid: cookie.token!.sid as string, enabledAtMs: ENROLLED_AT.getTime() }, Date.now());
  const token = await authOptions.callbacks!.jwt!({
    token: { ...cookie.token },
    account: null,
    profile: undefined,
    trigger: "update",
    session: { mfaProof: proof },
  } as never);
  cookie.token = { ...token }; // what next-auth writes back to the cookie
}

async function expectEverythingNotFound() {
  for (const call of [() => adminUsers(req("/api/admin/users")), () => moderasiQueue(req("/api/moderasi/bank-accounts"))]) {
    const res = await call();
    expect(res.status).toBe(404);
  }
  await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(ModerasiLayout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND");
}

describe("second factor and the panels", () => {
  beforeEach(() => {
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
    vi.stubEnv("MFA_ENROLL_GRACE_DAYS", "");
    cookie.token = null;
    cookie.trigger = undefined;
    cookie.update = undefined;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("an enrolled Admin and Verifier who has not entered a code gets 404 on /admin, /moderasi and their APIs", async () => {
    db.assignments = ["ADMIN", "VERIFIER"];
    db.enabledAt = ENROLLED_AT;
    await signIn();
    await expectEverythingNotFound();
  });

  it("an Admin who has not enrolled at all gets the same 404 (grace 0, the default)", async () => {
    db.assignments = ["ADMIN", "VERIFIER"];
    db.enabledAt = null;
    await signIn();
    await expectEverythingNotFound();
  });

  it("is served once the code has been proved for this session", async () => {
    db.assignments = ["ADMIN", "VERIFIER"];
    db.enabledAt = ENROLLED_AT;
    await signIn();
    await proveSecondFactor();
    expect((await adminUsers(req("/api/admin/users"))).status).toBe(200);
    expect((await moderasiQueue(req("/api/moderasi/bank-accounts"))).status).toBe(200);
    // the layouts pass the guard (they would go on to render the sidebar)
    await expect(AdminLayout({ children: null })).resolves.toBeTruthy();
    await expect(ModerasiLayout({ children: null })).resolves.toBeTruthy();
  });

  it("is closed again, on the very next request, when another Admin resets the factor", async () => {
    db.assignments = ["ADMIN", "VERIFIER"];
    db.enabledAt = ENROLLED_AT;
    await signIn();
    await proveSecondFactor();
    expect((await adminUsers(req("/api/admin/users"))).status).toBe(200);

    db.enabledAt = null;
    await expectEverythingNotFound();
  });

  it("answers the same 404 to a person who never held the assignment (nothing distinguishes the two)", async () => {
    db.assignments = [];
    db.enabledAt = null;
    await signIn();
    const held = await adminUsers(req("/api/admin/users"));
    expect(held.status).toBe(404);
    expect(await held.json()).toEqual({ error: "Not Found" });

    db.assignments = ["ADMIN"];
    db.enabledAt = ENROLLED_AT;
    await signIn();
    const gated = await adminUsers(req("/api/admin/users"));
    expect(gated.status).toBe(404);
    expect(await gated.json()).toEqual({ error: "Not Found" });
  });
});
