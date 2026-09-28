import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

/**
 * Service-layer tests for granting and revoking VERIFIER and ADMIN (ticket
 * 07/20; CONTEXT.md, Admin). The route only parses and maps errors; every
 * rule lives here and is tested at this seam, the same split
 * bank-account-verification.test.ts uses for its command module.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
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
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import {
  grantVerifierAssignment,
  proposeAdminGrant,
  confirmAdminGrant,
  withdrawAdminGrant,
  revokeAssignment,
  pendingAdminGrantRequests,
} from "./assignments";
import {
  AssignmentAlreadyGrantedError,
  AssignmentGrantAlreadyPendingError,
  AssignmentGrantRequestNotFoundError,
  AssignmentGrantNotPendingError,
  AssignmentSelfConfirmationError,
  AssignmentGrantNotOwnProposalError,
  AssignmentSelfRevokeError,
  LastAdminAssignmentError,
  AssignmentNotHeldError,
} from "./assignment-errors";
import { Prisma } from "@/generated/prisma/client";

const mockFindUnique = prisma.userAssignment.findUnique as unknown as Mock;
const mockUpsert = prisma.userAssignment.upsert as unknown as Mock;
const mockDelete = prisma.userAssignment.delete as unknown as Mock;
const mockCount = prisma.userAssignment.count as unknown as Mock;
const mockAuditCreate = prisma.assignmentAuditEntry.create as unknown as Mock;
const mockGrantFindUnique = prisma.assignmentGrantRequest.findUnique as unknown as Mock;
const mockGrantFindFirst = prisma.assignmentGrantRequest.findFirst as unknown as Mock;
const mockGrantCreate = prisma.assignmentGrantRequest.create as unknown as Mock;
const mockGrantUpdateMany = prisma.assignmentGrantRequest.updateMany as unknown as Mock;
const mockGrantFindMany = prisma.assignmentGrantRequest.findMany as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockQueryRaw = prisma.$queryRaw as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
});

describe("grantVerifierAssignment", () => {
  it("grants the assignment, records the audit entry, and notifies the grantee", async () => {
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });

    await grantVerifierAssignment(prisma as never, { userId: "user-2", grantedById: "admin-1" });

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

  it("records an optional reason, trimmed", async () => {
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });

    await grantVerifierAssignment(prisma as never, {
      userId: "user-2",
      grantedById: "admin-1",
      reason: "  needed for the queue  ",
    });

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ reason: "needed for the queue" }),
    });
  });

  it("is idempotent: granting an already-held VERIFIER assignment succeeds", async () => {
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    await grantVerifierAssignment(prisma as never, { userId: "user-2", grantedById: "admin-1" });
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});

describe("proposeAdminGrant", () => {
  beforeEach(() => {
    mockFindUnique.mockResolvedValue(null);
    mockGrantFindFirst.mockResolvedValue(null);
    mockGrantCreate.mockResolvedValue({
      id: "req-1",
      userId: "user-2",
      proposedById: "admin-1",
      outcome: "PENDING",
    });
  });

  it("creates a PENDING request and records a PROPOSED audit entry", async () => {
    const request = await proposeAdminGrant(prisma as never, { userId: "user-2", proposedById: "admin-1" });

    expect(request.outcome).toBe("PENDING");
    expect(mockGrantCreate).toHaveBeenCalledWith({
      data: { userId: "user-2", proposedById: "admin-1", proposedReason: null },
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: { userId: "user-2", assignment: "ADMIN", action: "PROPOSED", actedById: "admin-1", reason: null },
    });
  });

  it("allows a lone Admin to propose their own ADMIN grant (bootstrap case)", async () => {
    const request = await proposeAdminGrant(prisma as never, { userId: "admin-1", proposedById: "admin-1" });
    expect(request.outcome).toBe("PENDING");
  });

  it("refuses when the grantee already holds ADMIN", async () => {
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });

    await expect(
      proposeAdminGrant(prisma as never, { userId: "user-2", proposedById: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentAlreadyGrantedError);
    expect(mockGrantCreate).not.toHaveBeenCalled();
  });

  it("refuses a second proposal while one is already PENDING", async () => {
    mockGrantFindFirst.mockResolvedValue({ id: "req-0", userId: "user-2", outcome: "PENDING" });

    await expect(
      proposeAdminGrant(prisma as never, { userId: "user-2", proposedById: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentGrantAlreadyPendingError);
    expect(mockGrantCreate).not.toHaveBeenCalled();
  });

  it("turns a P2002 race on the partial unique index into the same refusal", async () => {
    mockGrantCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "0.0.0" })
    );

    await expect(
      proposeAdminGrant(prisma as never, { userId: "user-2", proposedById: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentGrantAlreadyPendingError);
  });
});

describe("confirmAdminGrant", () => {
  beforeEach(() => {
    mockGrantFindUnique.mockResolvedValue({
      id: "req-1",
      userId: "user-2",
      proposedById: "admin-1",
      outcome: "PENDING",
    });
    mockGrantUpdateMany.mockResolvedValue({ count: 1 });
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
  });

  it("confirms the grant, grants ADMIN, and records the audit entry", async () => {
    await confirmAdminGrant(prisma as never, { requestId: "req-1", confirmedById: "admin-2" });

    expect(mockGrantUpdateMany).toHaveBeenCalledWith({
      where: { id: "req-1", outcome: "PENDING" },
      data: expect.objectContaining({ outcome: "CONFIRMED", decidedById: "admin-2", decidedReason: null }),
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { userId_assignment: { userId: "user-2", assignment: "ADMIN" } },
      create: { userId: "user-2", assignment: "ADMIN" },
      update: {},
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: { userId: "user-2", assignment: "ADMIN", action: "GRANTED", actedById: "admin-2", reason: null },
    });
    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });

  it("refuses when the confirming Admin is the proposer", async () => {
    await expect(
      confirmAdminGrant(prisma as never, { requestId: "req-1", confirmedById: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentSelfConfirmationError);
    expect(mockGrantUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses when the confirming Admin is the grantee, even for a different proposer", async () => {
    mockGrantFindUnique.mockResolvedValue({
      id: "req-1",
      userId: "admin-2",
      proposedById: "admin-1",
      outcome: "PENDING",
    });

    await expect(
      confirmAdminGrant(prisma as never, { requestId: "req-1", confirmedById: "admin-2" })
    ).rejects.toBeInstanceOf(AssignmentSelfConfirmationError);
    expect(mockGrantUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a self-proposed bootstrap grant confirmed by the same person", async () => {
    mockGrantFindUnique.mockResolvedValue({
      id: "req-1",
      userId: "admin-1",
      proposedById: "admin-1",
      outcome: "PENDING",
    });

    await expect(
      confirmAdminGrant(prisma as never, { requestId: "req-1", confirmedById: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentSelfConfirmationError);
  });

  it("returns 404 when the request does not exist", async () => {
    mockGrantFindUnique.mockResolvedValue(null);
    await expect(
      confirmAdminGrant(prisma as never, { requestId: "missing", confirmedById: "admin-2" })
    ).rejects.toBeInstanceOf(AssignmentGrantRequestNotFoundError);
  });

  it("cannot confirm a request twice: the conditional updateMany losing the race throws", async () => {
    mockGrantUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      confirmAdminGrant(prisma as never, { requestId: "req-1", confirmedById: "admin-2" })
    ).rejects.toBeInstanceOf(AssignmentGrantNotPendingError);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("withdrawAdminGrant", () => {
  beforeEach(() => {
    mockGrantFindUnique.mockResolvedValue({
      id: "req-1",
      userId: "user-2",
      proposedById: "admin-1",
      outcome: "PENDING",
    });
    mockGrantUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("lets the proposer withdraw their own pending proposal", async () => {
    await withdrawAdminGrant(prisma as never, { requestId: "req-1", actorId: "admin-1" });
    expect(mockGrantUpdateMany).toHaveBeenCalledWith({
      where: { id: "req-1", outcome: "PENDING" },
      data: expect.objectContaining({ outcome: "WITHDRAWN", decidedById: "admin-1" }),
    });
  });

  it("refuses when the actor is not the proposer", async () => {
    await expect(
      withdrawAdminGrant(prisma as never, { requestId: "req-1", actorId: "admin-2" })
    ).rejects.toBeInstanceOf(AssignmentGrantNotOwnProposalError);
    expect(mockGrantUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the request does not exist", async () => {
    mockGrantFindUnique.mockResolvedValue(null);
    await expect(
      withdrawAdminGrant(prisma as never, { requestId: "missing", actorId: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentGrantRequestNotFoundError);
  });

  it("throws when the request already left PENDING under a race", async () => {
    mockGrantUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      withdrawAdminGrant(prisma as never, { requestId: "req-1", actorId: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentGrantNotPendingError);
  });
});

describe("revokeAssignment", () => {
  beforeEach(() => {
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockDelete.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockCount.mockResolvedValue(2);
    mockQueryRaw.mockResolvedValue([]);
  });

  it("revokes the assignment and records the audit entry", async () => {
    await revokeAssignment(prisma as never, { userId: "user-2", assignment: "VERIFIER", revokedById: "admin-1" });

    expect(mockDelete).toHaveBeenCalledWith({
      where: { userId_assignment: { userId: "user-2", assignment: "VERIFIER" } },
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: { userId: "user-2", assignment: "VERIFIER", action: "REVOKED", actedById: "admin-1", reason: null },
    });
    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });

  it("refuses an Admin revoking their own ADMIN assignment", async () => {
    mockFindUnique.mockResolvedValue({ userId: "admin-1", assignment: "ADMIN" });
    await expect(
      revokeAssignment(prisma as never, { userId: "admin-1", assignment: "ADMIN", revokedById: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentSelfRevokeError);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("refuses an Admin revoking their own VERIFIER assignment (the known gap this ticket closes)", async () => {
    mockFindUnique.mockResolvedValue({ userId: "admin-1", assignment: "VERIFIER" });
    await expect(
      revokeAssignment(prisma as never, { userId: "admin-1", assignment: "VERIFIER", revokedById: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentSelfRevokeError);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 404 when the target does not hold the assignment", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(
      revokeAssignment(prisma as never, { userId: "user-2", assignment: "VERIFIER", revokedById: "admin-1" })
    ).rejects.toBeInstanceOf(AssignmentNotHeldError);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("refuses revoking the last ADMIN assignment, even acted on by a different admin", async () => {
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    mockCount.mockResolvedValue(1);

    await expect(
      revokeAssignment(prisma as never, { userId: "user-2", assignment: "ADMIN", revokedById: "admin-1" })
    ).rejects.toBeInstanceOf(LastAdminAssignmentError);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("does not lock or count ADMIN headcount when revoking a non-ADMIN assignment", async () => {
    await revokeAssignment(prisma as never, { userId: "user-2", assignment: "VERIFIER", revokedById: "admin-1" });
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("allows revoking an ADMIN assignment when more than one ADMIN holder remains", async () => {
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    mockCount.mockResolvedValue(2);

    await revokeAssignment(prisma as never, { userId: "user-2", assignment: "ADMIN", revokedById: "admin-1" });
    expect(mockDelete).toHaveBeenCalledOnce();
  });
});

describe("pendingAdminGrantRequests", () => {
  it("lists PENDING requests oldest first", async () => {
    mockGrantFindMany.mockResolvedValue([
      {
        id: "req-1",
        userId: "user-2",
        proposedById: "admin-1",
        proposedAt: new Date(),
        proposedReason: null,
        user: { name: "User Two" },
        proposedBy: { name: "Admin One" },
      },
    ]);

    const rows = await pendingAdminGrantRequests(prisma as never);

    expect(rows).toHaveLength(1);
    expect(mockGrantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { outcome: "PENDING" }, orderBy: { proposedAt: "asc" } })
    );
  });
});
