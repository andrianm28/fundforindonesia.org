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
      count: vi.fn(),
    },
    assignmentAuditEntry: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POST, DELETE } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockUpsert = prisma.userAssignment.upsert as unknown as Mock;
const mockAuditCreate = prisma.assignmentAuditEntry.create as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;
const mockCount = prisma.userAssignment.count as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockQueryRaw = prisma.$queryRaw as unknown as Mock;

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
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockAuditCreate.mockResolvedValue({});
    mockNotificationCreate.mockResolvedValue({});
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 403 for a Verifier who does not hold the Admin assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "someone-1", assignments: [] } });
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

  it("does not notify, and surfaces an error, if the audit write fails inside the transaction", async () => {
    mockAuditCreate.mockRejectedValue(new Error("db unavailable"));
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());

    expect(response.status).toBe(500);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });
});

const mockFindUnique = prisma.userAssignment.findUnique as unknown as Mock;
const mockDelete = prisma.userAssignment.delete as unknown as Mock;

function deleteRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/users/user-2/assignments", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("DELETE /api/admin/users/[id]/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockDelete.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockAuditCreate.mockResolvedValue({});
    mockNotificationCreate.mockResolvedValue({});
    mockCount.mockResolvedValue(2);
    mockQueryRaw.mockResolvedValue([]);
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "someone-1", assignments: [] } });
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid assignment value", async () => {
    const response = await DELETE(deleteRequest({ assignment: "SUPERADMIN" }), routeContext());
    expect(response.status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("refuses to let an admin revoke their own ADMIN assignment", async () => {
    const response = await DELETE(deleteRequest({ assignment: "ADMIN" }), routeContext("admin-1"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Cannot revoke your own ADMIN assignment");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("allows an admin to revoke their own VERIFIER assignment", async () => {
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext("admin-1"));
    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledOnce();
  });

  it("returns 404 when the user does not currently hold the assignment", async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());

    expect(response.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("revokes the assignment, records the audit entry, and notifies the user", async () => {
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ userId: "user-2", assignment: "VERIFIER", action: "REVOKED" });

    expect(mockDelete).toHaveBeenCalledWith({
      where: { userId_assignment: { userId: "user-2", assignment: "VERIFIER" } },
    });

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-2",
        assignment: "VERIFIER",
        action: "REVOKED",
        actedById: "admin-1",
      },
    });

    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });

  it("refuses to revoke the last ADMIN assignment, even when acted on by a different admin", async () => {
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    mockCount.mockResolvedValue(1);

    const response = await DELETE(deleteRequest({ assignment: "ADMIN" }), routeContext("user-2"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Cannot revoke the last ADMIN assignment");
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("does not check ADMIN headcount when revoking a non-ADMIN assignment", async () => {
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());

    expect(response.status).toBe(200);
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("locks the ADMIN rowset before counting, only on the ADMIN branch", async () => {
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    mockDelete.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    mockCount.mockResolvedValue(2);

    const response = await DELETE(deleteRequest({ assignment: "ADMIN" }), routeContext("user-2"));

    expect(response.status).toBe(200);
    expect(mockQueryRaw).toHaveBeenCalledOnce();
    expect(mockQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(mockCount.mock.invocationCallOrder[0]);
  });

  it("allows revoking an ADMIN assignment when more than one ADMIN holder remains", async () => {
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    mockDelete.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    mockCount.mockResolvedValue(2);

    const response = await DELETE(deleteRequest({ assignment: "ADMIN" }), routeContext("user-2"));

    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledOnce();
  });
});
