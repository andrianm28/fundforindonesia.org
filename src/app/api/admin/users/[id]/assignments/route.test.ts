import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST/DELETE /api/admin/users/[id]/assignments (ticket 07/20; CONTEXT.md,
 * Admin). The route only parses the body and maps a domain refusal to HTTP;
 * the rules under test here -- granting VERIFIER directly, opening a
 * PENDING request for ADMIN, and refusing self-revoke of either kind --
 * live in @/lib/assignments and are exercised through the real service
 * layer, the same way manual-contributions/route.test.ts exercises its
 * service module through a mocked transaction client.
 */

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    userAssignment: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    assignmentAuditEntry: {
      create: vi.fn(),
    },
    assignmentGrantRequest: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  return { prisma: { ...tx, $transaction: (fn: (client: unknown) => unknown) => fn(tx) } };
});

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POST, DELETE } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockFindUnique = prisma.userAssignment.findUnique as unknown as Mock;
const mockUpsert = prisma.userAssignment.upsert as unknown as Mock;
const mockDelete = prisma.userAssignment.delete as unknown as Mock;
const mockCount = prisma.userAssignment.count as unknown as Mock;
const mockAuditCreate = prisma.assignmentAuditEntry.create as unknown as Mock;
const mockGrantFindFirst = prisma.assignmentGrantRequest.findFirst as unknown as Mock;
const mockGrantCreate = prisma.assignmentGrantRequest.create as unknown as Mock;
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
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockGrantFindFirst.mockResolvedValue(null);
    mockGrantCreate.mockResolvedValue({ id: "req-1", userId: "user-2", proposedById: "admin-1", outcome: "PENDING" });
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
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
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

  it("grants VERIFIER immediately, records the audit entry, and notifies the user", async () => {
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
      data: { userId: "user-2", assignment: "VERIFIER", action: "GRANTED", actedById: "admin-1", reason: null },
    });
    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });

  it("is idempotent: granting an already-held VERIFIER assignment succeeds without erroring", async () => {
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(201);
    expect(mockUpsert).toHaveBeenCalledOnce();
  });

  it("does not grant ADMIN directly: it opens a PENDING request instead", async () => {
    const response = await POST(createRequest({ assignment: "ADMIN" }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(202);
    expect(data).toEqual({ userId: "user-2", assignment: "ADMIN", action: "PROPOSED", requestId: "req-1" });
    expect(mockGrantCreate).toHaveBeenCalledWith({
      data: { userId: "user-2", proposedById: "admin-1", proposedReason: null },
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: { userId: "user-2", assignment: "ADMIN", action: "PROPOSED", actedById: "admin-1", reason: null },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses proposing ADMIN for someone who already holds it", async () => {
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    const response = await POST(createRequest({ assignment: "ADMIN" }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe("ASSIGNMENT_ALREADY_GRANTED");
    expect(mockGrantCreate).not.toHaveBeenCalled();
  });

  it("refuses a second ADMIN proposal while one is already pending", async () => {
    mockGrantFindFirst.mockResolvedValue({ id: "req-0", userId: "user-2", outcome: "PENDING" });
    const response = await POST(createRequest({ assignment: "ADMIN" }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe("ASSIGNMENT_GRANT_ALREADY_PENDING");
  });

  it("does not notify, and surfaces an error, if the audit write fails inside the transaction", async () => {
    mockAuditCreate.mockRejectedValue(new Error("db unavailable"));
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(500);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });
});

const mockDeleteRequestSession = getServerSession as unknown as Mock;

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
    mockDeleteRequestSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockDelete.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockAuditCreate.mockResolvedValue({});
    mockNotificationCreate.mockResolvedValue({});
    mockCount.mockResolvedValue(2);
  });

  it("returns 401 when unauthenticated", async () => {
    mockDeleteRequestSession.mockResolvedValue(null);
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment", async () => {
    mockDeleteRequestSession.mockResolvedValue({ user: { id: "someone-1", assignments: [] } });
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
    mockFindUnique.mockResolvedValue({ userId: "admin-1", assignment: "ADMIN" });
    const response = await DELETE(deleteRequest({ assignment: "ADMIN" }), routeContext("admin-1"));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe("ASSIGNMENT_SELF_REVOKE");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("refuses to let an admin revoke their own VERIFIER assignment (the known gap this ticket closes)", async () => {
    mockFindUnique.mockResolvedValue({ userId: "admin-1", assignment: "VERIFIER" });
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext("admin-1"));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe("ASSIGNMENT_SELF_REVOKE");
    expect(mockDelete).not.toHaveBeenCalled();
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
      data: { userId: "user-2", assignment: "VERIFIER", action: "REVOKED", actedById: "admin-1", reason: null },
    });

    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });

  it("refuses to revoke the last ADMIN assignment, even when acted on by a different admin", async () => {
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    mockCount.mockResolvedValue(1);

    const response = await DELETE(deleteRequest({ assignment: "ADMIN" }), routeContext("user-2"));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe("LAST_ADMIN_ASSIGNMENT");
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("does not check ADMIN headcount when revoking a non-ADMIN assignment", async () => {
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());

    expect(response.status).toBe(200);
    expect(mockCount).not.toHaveBeenCalled();
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
