import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/admin/assignment-grant-requests/[requestId]/decision (ticket
 * 07/20): the second Admin's half of the two-person ADMIN grant.
 *
 *   { decision: "confirm" }           -- grants ADMIN; a DIFFERENT Admin only.
 *   { decision: "withdraw" }          -- the proposer cancels their own proposal.
 *
 * The route owns only the ADMIN assignment gate and the HTTP shape; the
 * two-person rule and the conditional write live in @/lib/assignments.
 */

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const tx = {
    assignmentGrantRequest: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    userAssignment: {
      upsert: vi.fn(),
    },
    assignmentAuditEntry: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  };
  return { prisma: { ...tx, $transaction: (fn: (client: unknown) => unknown) => fn(tx) } };
});

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const mockSession = getServerSession as unknown as Mock;
const mockFindUnique = prisma.assignmentGrantRequest.findUnique as unknown as Mock;
const mockUpdateMany = prisma.assignmentGrantRequest.updateMany as unknown as Mock;
const mockUpsert = prisma.userAssignment.upsert as unknown as Mock;

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest("http://localhost:3000/api/admin/assignment-grant-requests/req-1/decision", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ requestId: "req-1" }) }
  );
}

describe("POST /api/admin/assignment-grant-requests/[requestId]/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "admin-2", assignments: ["ADMIN"] } });
    mockFindUnique.mockResolvedValue({ id: "req-1", userId: "user-2", proposedById: "admin-1", outcome: "PENDING" });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ decision: "confirm" })).status).toBe(401);
  });

  it("returns 403 without the ADMIN assignment", async () => {
    mockSession.mockResolvedValue({ user: { id: "someone-1", assignments: [] } });
    expect((await post({ decision: "confirm" })).status).toBe(403);
  });

  it("returns 400 for an unrecognised decision", async () => {
    const response = await post({ decision: "approve" });
    expect(response.status).toBe(400);
  });

  it("confirms the grant, granting ADMIN", async () => {
    const response = await post({ decision: "confirm" });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.action).toBe("GRANTED");
    expect(mockUpsert).toHaveBeenCalledOnce();
  });

  it("refuses confirming when the acting Admin is the proposer", async () => {
    mockSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    const response = await post({ decision: "confirm" });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe("ASSIGNMENT_SELF_CONFIRMATION");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses confirming when the acting Admin is the grantee", async () => {
    mockSession.mockResolvedValue({ user: { id: "user-2", assignments: ["ADMIN"] } });
    const response = await post({ decision: "confirm" });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe("ASSIGNMENT_SELF_CONFIRMATION");
  });

  it("returns 404 for a request that does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await post({ decision: "confirm" });
    expect(response.status).toBe(404);
  });

  it("returns 409 confirming a request already decided under a race", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const response = await post({ decision: "confirm" });
    const data = await response.json();
    expect(response.status).toBe(409);
    expect(data.code).toBe("ASSIGNMENT_GRANT_NOT_PENDING");
  });

  it("lets the proposer withdraw their own pending proposal", async () => {
    mockSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    const response = await post({ decision: "withdraw" });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.action).toBe("WITHDRAWN");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses withdrawing someone else's proposal", async () => {
    const response = await post({ decision: "withdraw" });
    const data = await response.json();
    expect(response.status).toBe(403);
    expect(data.code).toBe("ASSIGNMENT_GRANT_NOT_OWN_PROPOSAL");
  });
});
