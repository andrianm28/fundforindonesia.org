// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("@/lib/password-hash", () => ({ verifyPassword: vi.fn(), hashPassword: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { mintMfaProof } from "@/lib/mfa-proof";
import { sessionPasswordClaim } from "@/lib/password-reset";

/**
 * pks-pemenuhan/03, owner rule: until the second factor is satisfied, ADMIN and
 * VERIFIER holders carry NO authority in their session, so every existing
 * check (proxy, layouts, withAssignmentCheck) refuses them exactly as it
 * refuses a person who never held the assignment. These tests drive the real
 * `jwt` and `session` callbacks over a stubbed user row.
 */

const findUnique = prisma.user.findUnique as unknown as Mock;
const HASH = "$2b$12$" + "a".repeat(53);
const DAY = 24 * 60 * 60 * 1000;

type JwtParams = Parameters<NonNullable<NonNullable<typeof authOptions.callbacks>["jwt"]>>[0];
const jwt = (args: Record<string, unknown>) =>
  authOptions.callbacks!.jwt!({ account: null, profile: undefined, ...args } as unknown as JwtParams);

function row(opts: { assignments?: string[]; enabledAt?: Date | null; assignedAt?: Date }) {
  return {
    password: HASH,
    assignments: (opts.assignments ?? []).map((assignment) => ({
      assignment,
      assignedAt: opts.assignedAt ?? new Date(Date.now() - 30 * DAY),
    })),
    mfa: opts.enabledAt ? { enabledAt: opts.enabledAt } : null,
  };
}

const ENROLLED_AT = new Date(Date.now() - 2 * DAY);

describe("jwt callback: second factor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
    vi.stubEnv("MFA_ENROLL_GRACE_DAYS", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function signIn() {
    return jwt({ token: {}, user: { id: "u1", email: "a@example.test" }, trigger: "signIn" });
  }

  it("signs an enrolled Admin in with no assignments and a 'challenge' state", async () => {
    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: ENROLLED_AT }));
    const token = await signIn();
    expect(token.assignments).toEqual([]);
    expect(token.mfaState).toBe("challenge");
    expect(typeof token.sid).toBe("string");
  });

  it("stays at no assignments on every later request until a proof arrives", async () => {
    findUnique.mockResolvedValue(row({ assignments: ["ADMIN", "VERIFIER"], enabledAt: ENROLLED_AT }));
    const first = await signIn();
    const later = await jwt({ token: { ...first } });
    expect(later.assignments).toEqual([]);
    expect(later.mfaState).toBe("challenge");
  });

  it("restores the real assignments when the update carries a proof for this session", async () => {
    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: ENROLLED_AT }));
    const first = await signIn();
    const proof = mintMfaProof({ userId: "u1", sid: first.sid as string, enabledAtMs: ENROLLED_AT.getTime() }, Date.now());
    const after = await jwt({ token: { ...first }, trigger: "update", session: { mfaProof: proof } });
    expect(after.assignments).toEqual(["ADMIN"]);
    expect(after.mfaState).toBe("verified");
    // and it persists on the next ordinary request
    const next = await jwt({ token: { ...after } });
    expect(next.assignments).toEqual(["ADMIN"]);
  });

  it("ignores a proof minted for another session", async () => {
    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: ENROLLED_AT }));
    const first = await signIn();
    const foreign = mintMfaProof({ userId: "u1", sid: "someone-elses-session", enabledAtMs: ENROLLED_AT.getTime() }, Date.now());
    const after = await jwt({ token: { ...first }, trigger: "update", session: { mfaProof: foreign } });
    expect(after.assignments).toEqual([]);
    expect(after.mfaState).toBe("challenge");
  });

  it("does not believe a client that merely claims to be verified", async () => {
    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: ENROLLED_AT }));
    const first = await signIn();
    for (const session of [
      { mfaVerified: true },
      { mfaState: "verified" },
      { mfaEnabledAt: ENROLLED_AT.getTime() },
      { assignments: ["ADMIN"] },
      { mfaProof: "x.y" },
    ]) {
      const after = await jwt({ token: { ...first }, trigger: "update", session });
      expect(after.assignments).toEqual([]);
      expect(after.mfaState).toBe("challenge");
    }
  });

  it("ignores a proof presented on an ordinary request rather than an update", async () => {
    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: ENROLLED_AT }));
    const first = await signIn();
    const proof = mintMfaProof({ userId: "u1", sid: first.sid as string, enabledAtMs: ENROLLED_AT.getTime() }, Date.now());
    const after = await jwt({ token: { ...first }, session: { mfaProof: proof } });
    expect(after.assignments).toEqual([]);
  });

  it("voids a verified session when the factor is reset, and again when it is redone", async () => {
    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: ENROLLED_AT }));
    const first = await signIn();
    const proof = mintMfaProof({ userId: "u1", sid: first.sid as string, enabledAtMs: ENROLLED_AT.getTime() }, Date.now());
    const verified = await jwt({ token: { ...first }, trigger: "update", session: { mfaProof: proof } });
    expect(verified.assignments).toEqual(["ADMIN"]);

    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: null })); // reset by another Admin
    const reset = await jwt({ token: { ...verified } });
    expect(reset.assignments).toEqual([]);
    expect(reset.mfaState).toBe("enroll");

    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: new Date() })); // enrolled again, elsewhere
    const redone = await jwt({ token: { ...verified } });
    expect(redone.assignments).toEqual([]);
    expect(redone.mfaState).toBe("challenge");
  });

  it("a fresh sign-in starts unverified even from a token that was verified", async () => {
    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: ENROLLED_AT }));
    const again = await jwt({
      token: { id: "u1", sid: "old", mfaEnabledAt: ENROLLED_AT.getTime(), pwf: sessionPasswordClaim(HASH) },
      user: { id: "u1" },
      trigger: "signIn",
    });
    expect(again.assignments).toEqual([]);
    expect(again.sid).not.toBe("old");
  });

  it("holds an unenrolled Admin at 'enroll' with no assignments when the grace is 0 (the default)", async () => {
    findUnique.mockResolvedValue(row({ assignments: ["ADMIN"], enabledAt: null }));
    const token = await signIn();
    expect(token.assignments).toEqual([]);
    expect(token.mfaState).toBe("enroll");
  });

  it("lets an unenrolled holder work inside MFA_ENROLL_GRACE_DAYS counted from the assignment", async () => {
    vi.stubEnv("MFA_ENROLL_GRACE_DAYS", "7");
    findUnique.mockResolvedValue(row({ assignments: ["VERIFIER"], enabledAt: null, assignedAt: new Date(Date.now() - 2 * DAY) }));
    const token = await signIn();
    expect(token.assignments).toEqual(["VERIFIER"]);
    expect(token.mfaState).toBe("grace");
  });

  it("does not touch a person with no panel assignment", async () => {
    findUnique.mockResolvedValue(row({ assignments: [], enabledAt: null }));
    const token = await signIn();
    expect(token.assignments).toEqual([]);
    expect(token.mfaState).toBe("none");
  });
});

type SessionUser = { user: { assignments: string[]; mfaState?: string } };

describe("session callback: second factor", () => {
  it("shows the state and the (empty) assignments, so the UI can send the person to /akun/keamanan", async () => {
    const session = (await authOptions.callbacks!.session!({
      session: { user: {}, expires: "2099-01-01" },
      token: { id: "u1", assignments: [], mfaState: "challenge" },
    } as never)) as unknown as SessionUser;
    expect(session.user.assignments).toEqual([]);
    expect(session.user.mfaState).toBe("challenge");
  });

  it("defaults the state to 'none' for a token from before this existed", async () => {
    const session = (await authOptions.callbacks!.session!({
      session: { user: {}, expires: "2099-01-01" },
      token: { id: "u1", assignments: [] },
    } as never)) as unknown as SessionUser;
    expect(session.user.mfaState).toBe("none");
  });
});
