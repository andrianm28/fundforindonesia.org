import { Assignment, Prisma } from "@/generated/prisma/client";
import type { AssignmentGrantRequest, PrismaClient, UserAssignment } from "@/generated/prisma/client";
import {
  AssignmentAlreadyGrantedError,
  AssignmentGrantAlreadyPendingError,
  AssignmentGrantNotOwnProposalError,
  AssignmentGrantNotPendingError,
  AssignmentGrantRequestNotFoundError,
  AssignmentNotHeldError,
  AssignmentSelfConfirmationError,
  AssignmentSelfRevokeError,
  LastAdminAssignmentError,
} from "./assignment-errors";

/**
 * Granting and revoking VERIFIER and ADMIN (ticket 07/20; CONTEXT.md,
 * Admin). The rule was previously unwritten in code: one Admin could grant
 * ADMIN to anyone with no second person agreeing, and self-revoke was
 * refused only for ADMIN, not VERIFIER. This module is the service layer
 * the route (../app/api/admin/users/[id]/assignments/route.ts) now calls
 * instead of writing UserAssignment directly -- every rule lives here, not
 * in the route, the same split bank-account-verification.ts uses.
 *
 * - Granting VERIFIER: one Admin, immediate (`grantVerifierAssignment`).
 * - Granting ADMIN: two Admins. One proposes (`proposeAdminGrant`), which
 *   opens a PENDING AssignmentGrantRequest -- mirroring
 *   BankAccountVerificationRequest (ticket 16; ADR 0018) rather than
 *   inventing a new pending-request shape, per the ticket's own answer. A
 *   DIFFERENT Admin confirms (`confirmAdminGrant`), which is the only path
 *   that ever grants ADMIN. The confirming Admin may be neither the
 *   proposer nor the grantee -- two Admins agreeing is only a real control
 *   if they cannot be the same person twice, and a grantee approving their
 *   own elevation is the same hole under a different name. A lone Admin may
 *   propose their own grant for someone else (there is nothing unusual
 *   there); a lone Admin proposing *themselves* as a second Admin is the
 *   one-Admin-organisation bootstrap case the ticket accepts explicitly --
 *   the proposal is allowed, and it simply waits, like any other, for a
 *   second Admin to confirm it. The proposer may withdraw their own pending
 *   proposal (`withdrawAdminGrant`), the same shape as withdrawing a Bank
 *   Account submission.
 * - Revoking either assignment: nobody may revoke their own
 *   (`revokeAssignment`), closing the known gap where only ADMIN self-revoke
 *   was refused. The last ADMIN can never be revoked (row-locked headcount
 *   guard, unchanged from before this ticket).
 *
 * Every step writes an AssignmentAuditEntry (PROPOSED, GRANTED, or REVOKED)
 * with an optional `reason`, consistent with CampaignStatusChange.reason
 * (ticket 07/20 answer). No expiry on a pending grant: the ticket leaves
 * that open, and the smallest honest choice is the one
 * BankAccountVerificationRequest already makes -- it waits.
 */

const MAX_REASON_LENGTH = 500;

/** An optional free-text reason: trimmed, null when blank or absent. */
function optionalReason(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = typeof raw === "string" ? raw.trim() : "";
  return text === "" ? null : text.slice(0, MAX_REASON_LENGTH);
}

// ==================== Granting ====================

/** A single Admin's direct grant of VERIFIER (ticket 07/20 decision). */
export async function grantVerifierAssignment(
  prisma: PrismaClient,
  params: { userId: string; grantedById: string; reason?: unknown }
): Promise<UserAssignment> {
  const reason = optionalReason(params.reason);
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.userAssignment.upsert({
      where: { userId_assignment: { userId: params.userId, assignment: Assignment.VERIFIER } },
      create: { userId: params.userId, assignment: Assignment.VERIFIER },
      update: {},
    });

    await tx.assignmentAuditEntry.create({
      data: { userId: params.userId, assignment: Assignment.VERIFIER, action: "GRANTED", actedById: params.grantedById, reason },
    });

    await tx.notification.create({
      data: {
        type: "assignment_granted",
        title: "Assignment Granted",
        message: "You have been granted the VERIFIER assignment.",
        userId: params.userId,
        link: "/akun",
      },
    });

    return assignment;
  });
}

/**
 * One Admin proposes granting ADMIN to `userId` (ticket 07/20). Opens a
 * PENDING AssignmentGrantRequest and records a PROPOSED audit entry -- the
 * audit trail now shows that a second Admin was asked, closing the gap the
 * grilling noted ("an audit trail that only records the finished grant
 * cannot show that a second person was asked").
 */
export async function proposeAdminGrant(
  prisma: PrismaClient,
  params: { userId: string; proposedById: string; reason?: unknown }
): Promise<AssignmentGrantRequest> {
  const reason = optionalReason(params.reason);
  return prisma.$transaction(async (tx) => {
    const held = await tx.userAssignment.findUnique({
      where: { userId_assignment: { userId: params.userId, assignment: Assignment.ADMIN } },
    });
    if (held) throw new AssignmentAlreadyGrantedError();

    const pending = await tx.assignmentGrantRequest.findFirst({
      where: { userId: params.userId, outcome: "PENDING" },
    });
    if (pending) throw new AssignmentGrantAlreadyPendingError();

    // The findFirst above is the friendly refusal; the partial unique index
    // "AssignmentGrantRequest_userId_pending_key" is the rule. Two proposals
    // racing past the check both reach this create, and the index keeps the
    // first: the loser's P2002 is the same refusal.
    const request = await tx.assignmentGrantRequest
      .create({ data: { userId: params.userId, proposedById: params.proposedById, proposedReason: reason } })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AssignmentGrantAlreadyPendingError();
        }
        throw error;
      });

    await tx.assignmentAuditEntry.create({
      data: { userId: params.userId, assignment: Assignment.ADMIN, action: "PROPOSED", actedById: params.proposedById, reason },
    });

    return request;
  });
}

/**
 * A DIFFERENT Admin confirms a PENDING AssignmentGrantRequest (ticket
 * 07/20). The only path that ever grants ADMIN. Refuses when the confirming
 * Admin is the proposer or the grantee -- checked before the conditional
 * write, and the write itself stays conditional on PENDING so the same
 * request cannot be confirmed twice under a race.
 */
export async function confirmAdminGrant(
  prisma: PrismaClient,
  params: { requestId: string; confirmedById: string; reason?: unknown }
): Promise<AssignmentGrantRequest> {
  const reason = optionalReason(params.reason);
  return prisma.$transaction(async (tx) => {
    const request = await tx.assignmentGrantRequest.findUnique({ where: { id: params.requestId } });
    if (!request) throw new AssignmentGrantRequestNotFoundError();

    if (params.confirmedById === request.proposedById || params.confirmedById === request.userId) {
      throw new AssignmentSelfConfirmationError();
    }

    const closed = await tx.assignmentGrantRequest.updateMany({
      where: { id: request.id, outcome: "PENDING" },
      data: { outcome: "CONFIRMED", decidedById: params.confirmedById, decidedAt: new Date(), decidedReason: reason },
    });
    if (closed.count === 0) throw new AssignmentGrantNotPendingError();

    await tx.userAssignment.upsert({
      where: { userId_assignment: { userId: request.userId, assignment: Assignment.ADMIN } },
      create: { userId: request.userId, assignment: Assignment.ADMIN },
      update: {},
    });

    await tx.assignmentAuditEntry.create({
      data: { userId: request.userId, assignment: Assignment.ADMIN, action: "GRANTED", actedById: params.confirmedById, reason },
    });

    await tx.notification.create({
      data: {
        type: "assignment_granted",
        title: "Assignment Granted",
        message: "You have been granted the ADMIN assignment.",
        userId: request.userId,
        link: "/akun",
      },
    });

    return { ...request, outcome: "CONFIRMED", decidedById: params.confirmedById, decidedReason: reason };
  });
}

/** The proposer withdraws their own PENDING AssignmentGrantRequest. */
export async function withdrawAdminGrant(
  prisma: PrismaClient,
  params: { requestId: string; actorId: string }
): Promise<AssignmentGrantRequest> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.assignmentGrantRequest.findUnique({ where: { id: params.requestId } });
    if (!request) throw new AssignmentGrantRequestNotFoundError();
    if (request.proposedById !== params.actorId) throw new AssignmentGrantNotOwnProposalError();

    const closed = await tx.assignmentGrantRequest.updateMany({
      where: { id: request.id, outcome: "PENDING" },
      data: { outcome: "WITHDRAWN", decidedById: params.actorId, decidedAt: new Date() },
    });
    if (closed.count === 0) throw new AssignmentGrantNotPendingError();

    return { ...request, outcome: "WITHDRAWN", decidedById: params.actorId };
  });
}

// ==================== Revoking ====================

/**
 * Revokes an assignment. Nobody may revoke their own, of either kind
 * (ticket 07/20 decision) -- the known gap this ticket closes was that only
 * ADMIN self-revoke was refused. Revoking the last ADMIN is refused under
 * the same row lock as before (unchanged by this ticket): the contended
 * resource is ADMIN headcount, not this row, so a lock on the whole ADMIN
 * rowset is what serialises two concurrent revokes of two different admins.
 */
export async function revokeAssignment(
  prisma: PrismaClient,
  params: { userId: string; assignment: Assignment; revokedById: string; reason?: unknown }
): Promise<UserAssignment> {
  if (params.revokedById === params.userId) {
    throw new AssignmentSelfRevokeError(params.assignment);
  }
  const reason = optionalReason(params.reason);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.userAssignment.findUnique({
      where: { userId_assignment: { userId: params.userId, assignment: params.assignment } },
    });
    if (!existing) throw new AssignmentNotHeldError();

    if (params.assignment === Assignment.ADMIN) {
      await tx.$queryRaw`SELECT "userId" FROM "UserAssignment" WHERE assignment = 'ADMIN' FOR UPDATE`;
      const adminCount = await tx.userAssignment.count({ where: { assignment: Assignment.ADMIN } });
      if (adminCount <= 1) throw new LastAdminAssignmentError();
    }

    await tx.userAssignment.delete({
      where: { userId_assignment: { userId: params.userId, assignment: params.assignment } },
    });

    await tx.assignmentAuditEntry.create({
      data: { userId: params.userId, assignment: params.assignment, action: "REVOKED", actedById: params.revokedById, reason },
    });

    await tx.notification.create({
      data: {
        type: "assignment_revoked",
        title: "Assignment Revoked",
        message: `Your ${params.assignment} assignment has been revoked.`,
        userId: params.userId,
        link: "/akun",
      },
    });

    return existing;
  });
}

// ==================== The Admin queue ====================

export type PendingAdminGrantRequest = {
  id: string;
  userId: string;
  userName: string | null;
  proposedById: string;
  proposedByName: string | null;
  proposedAt: Date;
  proposedReason: string | null;
};

/** Every PENDING AssignmentGrantRequest, oldest first: the Admin queue. */
export async function pendingAdminGrantRequests(
  prisma: Pick<PrismaClient, "assignmentGrantRequest">
): Promise<PendingAdminGrantRequest[]> {
  const requests = await prisma.assignmentGrantRequest.findMany({
    where: { outcome: "PENDING" },
    orderBy: { proposedAt: "asc" },
    include: {
      user: { select: { name: true } },
      proposedBy: { select: { name: true } },
    },
  });
  return requests.map((request) => ({
    id: request.id,
    userId: request.userId,
    userName: request.user.name,
    proposedById: request.proposedById,
    proposedByName: request.proposedBy.name,
    proposedAt: request.proposedAt,
    proposedReason: request.proposedReason,
  }));
}
