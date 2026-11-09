// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/lib/mfa", () => ({
  getMfaStatus: vi.fn(),
  beginEnrollment: vi.fn(),
  confirmEnrollment: vi.fn(),
  verifySecondFactor: vi.fn(),
  regenerateBackupCodes: vi.fn(),
}));

import { getServerSession } from "@/lib/auth";
import { getToken } from "next-auth/jwt";
import * as mfa from "@/lib/mfa";
import { readMfaProof } from "@/lib/mfa-proof";
import { GET as status } from "./route";
import { POST as setup } from "./setup/route";
import { POST as confirm } from "./confirm/route";
import { POST as verify } from "./verify/route";
import { POST as backupCodes } from "./backup-codes/route";

const session = getServerSession as unknown as Mock;
const token = getToken as unknown as Mock;
const m = mfa as unknown as Record<string, Mock>;

const ENABLED_AT = new Date("2026-11-01T00:00:00Z");

function post(body: unknown) {
  return new NextRequest("http://localhost:3000/api/account/mfa/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("account MFA routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
    session.mockResolvedValue({ user: { id: "u1", email: "a@example.test", assignments: [], mfaState: "challenge" } });
    token.mockResolvedValue({ id: "u1", sid: "sid-1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  describe.each([
    ["status", () => status()],
    ["setup", () => setup()],
    ["confirm", () => confirm(post({ code: "123456" }))],
    ["verify", () => verify(post({ code: "123456" }))],
    ["backup-codes", () => backupCodes(post({ code: "123456" }))],
  ])("%s", (_name, call) => {
    it("is 401 without a session", async () => {
      session.mockResolvedValue(null);
      expect((await call()).status).toBe(401);
    });
  });

  describe("verify", () => {
    it("returns a proof bound to this user, session and enrolment when the code is right", async () => {
      m.verifySecondFactor.mockResolvedValue({ ok: true, enabledAt: ENABLED_AT });
      const res = await verify(post({ code: "123456" }));
      expect(res.status).toBe(200);
      const { proof } = await res.json();
      expect(readMfaProof(proof, { userId: "u1", sid: "sid-1" }, Date.now())).toBe(ENABLED_AT.getTime());
      expect(readMfaProof(proof, { userId: "u1", sid: "other" }, Date.now())).toBeNull();
      expect(m.verifySecondFactor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "u1", code: "123456" }));
    });

    it("is 400 for a wrong code, with no proof", async () => {
      m.verifySecondFactor.mockResolvedValue({ ok: false, reason: "invalid" });
      const res = await verify(post({ code: "000000" }));
      expect(res.status).toBe(400);
      expect(await res.json()).not.toHaveProperty("proof");
    });

    it("is 429 with Retry-After when limited, 503 when the limiter is down, 409 when not enrolled", async () => {
      m.verifySecondFactor.mockResolvedValue({ ok: false, reason: "limited", retryAfterSeconds: 120 });
      const limited = await verify(post({ code: "1" }));
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toBe("120");
      m.verifySecondFactor.mockResolvedValue({ ok: false, reason: "unavailable" });
      expect((await verify(post({ code: "1" }))).status).toBe(503);
      m.verifySecondFactor.mockResolvedValue({ ok: false, reason: "not_enrolled" });
      expect((await verify(post({ code: "1" }))).status).toBe(409);
    });

    it("is 400 for a missing or non-string code, without calling the service", async () => {
      for (const body of [{}, { code: 123456 }, { code: "" }, null]) {
        expect((await verify(post(body))).status).toBe(400);
      }
      expect(m.verifySecondFactor).not.toHaveBeenCalled();
    });

    it("asks for a reload when the cookie has no session id yet (it cannot bind a proof)", async () => {
      token.mockResolvedValue({ id: "u1" });
      m.verifySecondFactor.mockResolvedValue({ ok: true, enabledAt: ENABLED_AT });
      const res = await verify(post({ code: "123456" }));
      expect(res.status).toBe(409);
      expect(m.verifySecondFactor).not.toHaveBeenCalled();
    });

    it("refuses a cookie whose token names someone else than the session", async () => {
      token.mockResolvedValue({ id: "u2", sid: "sid-1" });
      expect((await verify(post({ code: "123456" }))).status).toBe(409);
    });
  });

  describe("setup", () => {
    it("returns the secret and the otpauth URI for the signed-in person", async () => {
      m.beginEnrollment.mockResolvedValue({ ok: true, secret: "ABCDEF", uri: "otpauth://totp/x" });
      const res = await setup();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ secret: "ABCDEF", uri: "otpauth://totp/x" });
      expect(m.beginEnrollment).toHaveBeenCalledWith(expect.anything(), { userId: "u1", account: "a@example.test" });
    });

    it("is 409 once already enrolled", async () => {
      m.beginEnrollment.mockResolvedValue({ ok: false, reason: "already_enrolled" });
      expect((await setup()).status).toBe(409);
    });
  });

  describe("confirm", () => {
    it("returns the backup codes once, and a proof so this session is satisfied by enrolling", async () => {
      m.confirmEnrollment.mockResolvedValue({ ok: true, backupCodes: ["aaaaa-bbbbb"], enabledAt: ENABLED_AT });
      const res = await confirm(post({ code: "123456" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.backupCodes).toEqual(["aaaaa-bbbbb"]);
      expect(readMfaProof(body.proof, { userId: "u1", sid: "sid-1" }, Date.now())).toBe(ENABLED_AT.getTime());
    });

    it("is 400 for a wrong code and 409 when there is nothing pending", async () => {
      m.confirmEnrollment.mockResolvedValue({ ok: false, reason: "invalid" });
      expect((await confirm(post({ code: "000000" }))).status).toBe(400);
      m.confirmEnrollment.mockResolvedValue({ ok: false, reason: "no_pending" });
      expect((await confirm(post({ code: "000000" }))).status).toBe(409);
    });
  });

  describe("backup-codes", () => {
    it("issues new codes for a valid TOTP code, and not for a refused one", async () => {
      m.regenerateBackupCodes.mockResolvedValue({ ok: true, backupCodes: ["ccccc-ddddd"] });
      const res = await backupCodes(post({ code: "123456" }));
      expect(await res.json()).toEqual({ backupCodes: ["ccccc-ddddd"] });
      m.regenerateBackupCodes.mockResolvedValue({ ok: false, reason: "invalid" });
      expect((await backupCodes(post({ code: "000000" }))).status).toBe(400);
    });

    it("always passes the person's own TOTP code to the service, so a password alone cannot mint codes", async () => {
      m.regenerateBackupCodes.mockResolvedValue({ ok: true, backupCodes: ["x"] });
      await backupCodes(post({ code: "123456" }));
      expect(m.regenerateBackupCodes).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "u1", code: "123456" }));
      expect((await backupCodes(post({}))).status).toBe(400);
    });
  });

  describe("status", () => {
    it("reports the person's own factor and session state", async () => {
      m.getMfaStatus.mockResolvedValue({ enrolled: true, pending: false, enabledAt: ENABLED_AT, backupCodesRemaining: 7 });
      const res = await status();
      expect(await res.json()).toEqual({ state: "challenge", enrolled: true, pending: false, backupCodesRemaining: 7 });
    });
  });
});
