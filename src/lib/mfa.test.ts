// @vitest-environment node
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/rate-limit-guard", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyMfaChange: vi.fn() }));
vi.mock("@/lib/totp", async (orig) => ({ ...(await orig<typeof import("@/lib/totp")>()), verifyTotp: vi.fn() }));
vi.mock("@/lib/password-hash", () => ({ hashPassword: vi.fn(async (s: string) => `h:${s}`), verifyPassword: vi.fn() }));
vi.mock("@/lib/contact-fields", () => ({
  requireFieldKeys: () => ({
    encrypt: (_f: string, v: string) => ({ ciphertext: `enc:${v}`, keyId: "k" }),
    decrypt: (_f: string, s: { ciphertext: string }) => s.ciphertext.replace("enc:", ""),
  }),
}));

import { checkRateLimit } from "@/lib/rate-limit-guard";
import { notifyMfaChange } from "@/lib/notifications";
import { verifyTotp } from "@/lib/totp";
import { beginEnrollment, confirmEnrollment, regenerateBackupCodes, verifySecondFactor } from "./mfa";
import type { PrismaClient } from "@/generated/prisma/client";

const limiter = checkRateLimit as unknown as Mock;
const notify = notifyMfaChange as unknown as Mock;
const totp = verifyTotp as unknown as Mock;

const ENABLED_AT = new Date("2026-11-01T00:00:00Z");
const NOW = Date.UTC(2026, 10, 9);

function fakePrisma(row: unknown = { enabledAt: ENABLED_AT, secretCiphertext: "enc:s", secretKeyId: "k" }) {
  const tx = {
    userMfa: { updateMany: vi.fn(async () => ({ count: 1 })) },
    mfaBackupCode: { deleteMany: vi.fn(), createMany: vi.fn() },
    mfaAuditEntry: { create: vi.fn() },
  };
  const prisma = {
    userMfa: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    mfaBackupCode: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma };
}

/** Lets every scope through except the ones named, which answer `limited`. */
function limitOnly(...scopes: string[]) {
  limiter.mockImplementation(async (input: { scope: string }) =>
    scopes.includes(input.scope) ? { ok: false, reason: "limited", retryAfterSeconds: 777 } : { ok: true },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  limitOnly();
  notify.mockResolvedValue(undefined);
});

describe("verifySecondFactor: cumulative daily cap", () => {
  it("counts attempts per person in a 24h window, at most 20, failing closed", async () => {
    const { prisma } = fakePrisma();
    totp.mockReturnValue(null);
    await verifySecondFactor(prisma, { userId: "u1", code: "123456", now: NOW });
    expect(limiter).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "mfa-verify-daily", subject: "u1", limit: 20, windowSeconds: 86400, onUnavailable: "closed" }),
    );
  });

  it("refuses as 'locked' once the daily cap is hit, without looking at the code", async () => {
    const { prisma, raw } = fakePrisma();
    limitOnly("mfa-verify-daily");
    const r = await verifySecondFactor(prisma, { userId: "u1", code: "123456", now: NOW });
    expect(r).toEqual({ ok: false, reason: "locked", retryAfterSeconds: 777 });
    expect(raw.userMfa.findUnique).not.toHaveBeenCalled();
    expect(totp).not.toHaveBeenCalled();
  });

  it("still applies the short 5-minute limit first", async () => {
    const { prisma } = fakePrisma();
    limitOnly("mfa-verify");
    const r = await verifySecondFactor(prisma, { userId: "u1", code: "123456", now: NOW });
    expect(r).toEqual({ ok: false, reason: "limited", retryAfterSeconds: 777 });
  });

  it("applies to backup-code regeneration too, since it goes through the same check", async () => {
    const { prisma } = fakePrisma();
    limitOnly("mfa-verify-daily");
    const r = await regenerateBackupCodes(prisma, { userId: "u1", code: "123456", now: NOW });
    expect(r).toMatchObject({ ok: false, reason: "locked" });
  });
});

describe("beginEnrollment: rate limit", () => {
  it("allows 5 per hour per person", async () => {
    const { prisma } = fakePrisma(null);
    await beginEnrollment(prisma, { userId: "u1", account: "a@example.test" });
    expect(limiter).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "mfa-setup", subject: "u1", limit: 5, windowSeconds: 3600, onUnavailable: "closed" }),
    );
  });

  it("refuses when limited, without writing a new secret", async () => {
    const { prisma, raw } = fakePrisma(null);
    limitOnly("mfa-setup");
    const r = await beginEnrollment(prisma, { userId: "u1", account: "a@example.test" });
    expect(r).toEqual({ ok: false, reason: "limited", retryAfterSeconds: 777 });
    expect(raw.userMfa.upsert).not.toHaveBeenCalled();
  });
});

describe("notifying the account holder", () => {
  const pending = { enabledAt: null, secretCiphertext: "enc:s", secretKeyId: "k" };

  it("tells them when the factor is enabled, after the transaction commits", async () => {
    const { prisma, raw } = fakePrisma(pending);
    totp.mockReturnValue(10);
    let committed = false;
    (raw.$transaction as unknown as Mock).mockImplementation(async (fn: (t: unknown) => unknown) => {
      const out = await fn({
        userMfa: { updateMany: async () => ({ count: 1 }) },
        mfaBackupCode: { deleteMany: vi.fn(), createMany: vi.fn() },
        mfaAuditEntry: { create: vi.fn() },
      });
      committed = true;
      return out;
    });
    notify.mockImplementation(async () => expect(committed).toBe(true));
    const r = await confirmEnrollment(prisma, { userId: "u1", code: "123456", now: NOW });
    expect(r.ok).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.anything(), { userId: "u1", kind: "enabled" });
  });

  it("does not notify when the code is wrong", async () => {
    const { prisma } = fakePrisma(pending);
    totp.mockReturnValue(null);
    await confirmEnrollment(prisma, { userId: "u1", code: "000000", now: NOW });
    expect(notify).not.toHaveBeenCalled();
  });

  it("never blocks enrolment when the notification fails", async () => {
    const { prisma } = fakePrisma(pending);
    totp.mockReturnValue(10);
    notify.mockRejectedValue(new Error("db down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await confirmEnrollment(prisma, { userId: "u1", code: "123456", now: NOW });
    expect(r.ok).toBe(true);
    errors.mockRestore();
  });

  it("tells them when the backup codes are regenerated, and survives a failure", async () => {
    const { prisma } = fakePrisma();
    totp.mockReturnValue(11);
    const r = await regenerateBackupCodes(prisma, { userId: "u1", code: "123456", now: NOW });
    expect(r.ok).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.anything(), { userId: "u1", kind: "backup_codes_regenerated" });

    notify.mockRejectedValue(new Error("boom"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const again = await regenerateBackupCodes(prisma, { userId: "u1", code: "123456", now: NOW });
    expect(again.ok).toBe(true);
    errors.mockRestore();
  });
});
