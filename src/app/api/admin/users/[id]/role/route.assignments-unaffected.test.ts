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
    userAssignment: {
      create: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    assignmentAuditEntry: {
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
const mockAssignmentCreate = prisma.userAssignment.create as unknown as Mock;
const mockAssignmentUpsert = prisma.userAssignment.upsert as unknown as Mock;
const mockAssignmentDelete = prisma.userAssignment.delete as unknown as Mock;
const mockAssignmentDeleteMany = prisma.userAssignment.deleteMany as unknown as Mock;
const mockAuditCreate = prisma.assignmentAuditEntry.create as unknown as Mock;

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

describe("PATCH /api/admin/users/[id]/role never touches assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN"] } });
    mockUserUpdate.mockResolvedValue({ id: "user-2", name: "Someone", email: "someone@test.com", role: "ADMIN" });
    mockNotificationCreate.mockResolvedValue({});
  });

  it("promoting a user to ADMIN writes only role, never a UserAssignment or an audit entry", async () => {
    const response = await PATCH(createRequest({ role: "ADMIN" }), routeContext());

    expect(response.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
    expect(mockAssignmentUpsert).not.toHaveBeenCalled();
    expect(mockAssignmentDelete).not.toHaveBeenCalled();
    expect(mockAssignmentDeleteMany).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("demoting a user to DONOR writes only role, never a UserAssignment or an audit entry", async () => {
    mockUserUpdate.mockResolvedValue({ id: "user-2", name: "Someone", email: "someone@test.com", role: "DONOR" });
    const response = await PATCH(createRequest({ role: "DONOR" }), routeContext());

    expect(response.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
    expect(mockAssignmentUpsert).not.toHaveBeenCalled();
    expect(mockAssignmentDelete).not.toHaveBeenCalled();
    expect(mockAssignmentDeleteMany).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });
});
