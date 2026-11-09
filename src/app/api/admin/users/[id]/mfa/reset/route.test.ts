// @vitest-environment node
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/mfa", () => ({ resetMfa: vi.fn() }));

import { getServerSession } from "@/lib/auth";
import { resetMfa } from "@/lib/mfa";
import { POST } from "./route";

const session = getServerSession as unknown as Mock;
const reset = resetMfa as unknown as Mock;

const call = (body: unknown = {}) =>
  POST(
    new NextRequest("http://localhost:3000/api/admin/users/u2/mfa/reset", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "u2" }) },
  );

describe("POST /api/admin/users/[id]/mfa/reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
  });

  it("is 401 signed out, and 404 for anyone without the ADMIN assignment", async () => {
    session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    // including an Admin whose own second factor is not satisfied: their session carries no assignments
    session.mockResolvedValue({ user: { id: "admin-1", assignments: [], mfaState: "challenge" } });
    expect((await call()).status).toBe(404);
    session.mockResolvedValue({ user: { id: "v-1", assignments: ["VERIFIER"] } });
    expect((await call()).status).toBe(404);
    expect(reset).not.toHaveBeenCalled();
  });

  it("resets another person's factor, naming the acting Admin and the reason", async () => {
    reset.mockResolvedValue({ ok: true });
    const res = await call({ reason: "  HP hilang " });
    expect(res.status).toBe(200);
    expect(reset).toHaveBeenCalledWith(expect.anything(), { userId: "u2", actedById: "admin-1", reason: "  HP hilang " });
  });

  it("refuses a self-reset with 400 and a reset of someone with no factor with 409", async () => {
    reset.mockResolvedValue({ ok: false, reason: "self" });
    expect((await call()).status).toBe(400);
    reset.mockResolvedValue({ ok: false, reason: "not_enrolled" });
    expect((await call()).status).toBe(409);
  });

  it("ignores a reason that is not a string", async () => {
    reset.mockResolvedValue({ ok: true });
    await call({ reason: { x: 1 } });
    expect(reset).toHaveBeenCalledWith(expect.anything(), { userId: "u2", actedById: "admin-1", reason: undefined });
  });
});
