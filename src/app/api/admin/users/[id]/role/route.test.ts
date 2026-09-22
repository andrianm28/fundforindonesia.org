import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockUserUpdate = prisma.user.update as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/users/user-2/role", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function routeContext(id = "user-2") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/admin/users/[id]/role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN"] } });
    mockUserUpdate.mockResolvedValue({ id: "user-2", name: "Someone", email: "someone@test.com", role: "MODERATOR" });
    mockNotificationCreate.mockResolvedValue({});
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext());
    expect(response.status).toBe(401);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 for a Verifier who does not hold the Admin assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "someone-1", role: "ADMIN", assignments: [] } });
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("updates the role and notifies the affected user when the Admin assignment is present", async () => {
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext());

    expect(response.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { role: "MODERATOR" },
      select: { id: true, name: true, email: true, role: true },
    });
    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });

  it("rejects an invalid role with 400 before touching the database", async () => {
    const response = await PATCH(createRequest({ role: "NOT_A_ROLE" }), routeContext());
    expect(response.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("refuses to remove ADMIN from yourself", async () => {
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext("admin-1"));
    expect(response.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
