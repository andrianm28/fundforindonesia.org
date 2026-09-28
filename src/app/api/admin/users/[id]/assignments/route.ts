import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { grantVerifierAssignment, proposeAdminGrant, revokeAssignment } from "@/lib/assignments";
import { domainErrorToHttp } from "@/lib/domain-errors";

const VALID_ASSIGNMENTS: Assignment[] = ["VERIFIER", "ADMIN"];

/**
 * POST /api/admin/users/[id]/assignments (ticket 07/20; CONTEXT.md, Admin):
 *
 *   { assignment: "VERIFIER", reason? }  -- one Admin grants it immediately.
 *   { assignment: "ADMIN", reason? }     -- opens a PENDING
 *                                          AssignmentGrantRequest; a
 *                                          DIFFERENT Admin must confirm it on
 *                                          POST .../assignment-grant-requests/[requestId]/decision
 *                                          before ADMIN is actually granted.
 *
 * The route only parses the body and maps a refusal to HTTP; every rule --
 * the two-person ADMIN grant, idempotency, who may act -- lives in
 * @/lib/assignments, the same split the money and lifecycle routes use.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const { assignment, reason } = body;

  if (!assignment || !VALID_ASSIGNMENTS.includes(assignment as Assignment)) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  const session = await getServerSession();
  const actedById = session!.user.id as string;

  try {
    if (assignment === "VERIFIER") {
      await grantVerifierAssignment(prisma, { userId: id, grantedById: actedById, reason });
      return NextResponse.json({ userId: id, assignment, action: "GRANTED" }, { status: 201 });
    }

    const request = await proposeAdminGrant(prisma, { userId: id, proposedById: actedById, reason });
    return NextResponse.json(
      { userId: id, assignment, action: "PROPOSED", requestId: request.id },
      { status: 202 }
    );
  } catch (error) {
    const refusal = domainErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    throw error;
  }
});

/**
 * DELETE /api/admin/users/[id]/assignments: revokes VERIFIER or ADMIN.
 * Nobody may revoke their own assignment, of either kind (ticket 07/20
 * decision) -- the known gap this ticket closes was that only ADMIN
 * self-revoke was refused. The last ADMIN can never be revoked.
 */
export const DELETE = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const { assignment, reason } = body;

  if (!assignment || !VALID_ASSIGNMENTS.includes(assignment as Assignment)) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  const session = await getServerSession();
  const actedById = session!.user.id as string;

  try {
    await revokeAssignment(prisma, { userId: id, assignment: assignment as Assignment, revokedById: actedById, reason });
    return NextResponse.json({ userId: id, assignment, action: "REVOKED" }, { status: 200 });
  } catch (error) {
    const refusal = domainErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    throw error;
  }
});
