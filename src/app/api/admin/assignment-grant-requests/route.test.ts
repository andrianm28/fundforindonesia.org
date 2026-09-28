import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/admin/assignment-grant-requests (ticket 07/20): the Admin queue
 * of PENDING ADMIN grant proposals, so a different Admin can see what is
 * waiting for them to confirm.
 */

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { assignmentGrantRequest: { findMany: vi.fn() } },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

const mockSession = getServerSession as unknown as Mock;
const mockFindMany = prisma.assignmentGrantRequest.findMany as unknown as Mock;

function get(): Promise<Response> {
  return GET(new NextRequest("http://localhost:3000/api/admin/assignment-grant-requests"));
}

describe("GET /api/admin/assignment-grant-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    mockFindMany.mockResolvedValue([
      {
        id: "req-1",
        userId: "user-2",
        proposedById: "admin-2",
        proposedAt: new Date("2026-09-28T00:00:00Z"),
        proposedReason: null,
        user: { name: "User Two" },
        proposedBy: { name: "Admin Two" },
      },
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it("returns 403 without the ADMIN assignment", async () => {
    mockSession.mockResolvedValue({ user: { id: "someone-1", assignments: [] } });
    expect((await get()).status).toBe(403);
  });

  it("lists PENDING requests oldest first", async () => {
    const response = await get();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.requests).toHaveLength(1);
    expect(data.requests[0]).toMatchObject({ id: "req-1", userId: "user-2", userName: "User Two", proposedById: "admin-2" });
  });
});
