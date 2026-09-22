import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userAssignment: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    assignmentAuditEntry: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockUpsert = prisma.userAssignment.upsert as unknown as Mock;
const mockAuditCreate = prisma.assignmentAuditEntry.create as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/users/user-2/assignments", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function routeContext(id = "user-2") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/users/[id]/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN"] } });
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockAuditCreate.mockResolvedValue({});
    mockNotificationCreate.mockResolvedValue({});
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 403 for a Verifier who does not hold the Admin assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "someone-1", role: "ADMIN", assignments: [] } });
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid assignment value", async () => {
    const response = await POST(createRequest({ assignment: "SUPERADMIN" }), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 when assignment is missing from the body", async () => {
    const response = await POST(createRequest({}), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("grants the assignment, records the audit entry, and notifies the user", async () => {
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual({ userId: "user-2", assignment: "VERIFIER", action: "GRANTED" });

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { userId_assignment: { userId: "user-2", assignment: "VERIFIER" } },
      create: { userId: "user-2", assignment: "VERIFIER" },
      update: {},
    });

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-2",
        assignment: "VERIFIER",
        action: "GRANTED",
        actedById: "admin-1",
      },
    });

    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });

  it("is idempotent: granting an already-held assignment succeeds without erroring", async () => {
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    const response = await POST(createRequest({ assignment: "ADMIN" }), routeContext());
    expect(response.status).toBe(201);
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});
