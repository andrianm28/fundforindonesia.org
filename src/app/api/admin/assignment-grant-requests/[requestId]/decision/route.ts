import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { domainErrorToHttp } from "@/lib/domain-errors";
import { confirmAdminGrant, withdrawAdminGrant } from "@/lib/assignments";

/**
 * POST /api/admin/assignment-grant-requests/[requestId]/decision (ticket
 * 07/20; CONTEXT.md, Admin): the second half of the two-person ADMIN grant.
 *
 *   { decision: "confirm", reason? }   -- a DIFFERENT Admin grants ADMIN.
 *   { decision: "withdraw" }           -- the proposer cancels their own
 *                                         pending proposal, the same shape
 *                                         as withdrawing a Bank Account
 *                                         submission.
 *
 * `decision` is enumerated here rather than taken as a status to write, the
 * same shape as manual-contributions/[id]/decision -- so a request cannot
 * ask for a state the service layer does not recognise. The route owns only
 * the ADMIN assignment gate and the HTTP shape; the two-person rule and the
 * conditional write live in @/lib/assignments.
 *
 * ADMIN only.
 */
export const POST = withAssignmentCheck(
  Assignment.ADMIN,
  async (req: NextRequest, context: { params: Promise<{ requestId: string }> }) => {
    const { requestId } = await context.params;
    const session = await getServerSession();
    const actorId = session!.user.id as string;

    const body = await req.json().catch(() => ({}));
    const { decision, reason } = body as { decision?: unknown; reason?: unknown };

    try {
      if (decision === "confirm") {
        const request = await confirmAdminGrant(prisma, { requestId, confirmedById: actorId, reason });
        return NextResponse.json({ requestId: request.id, userId: request.userId, action: "GRANTED" }, { status: 200 });
      }

      if (decision === "withdraw") {
        const request = await withdrawAdminGrant(prisma, { requestId, actorId });
        return NextResponse.json({ requestId: request.id, userId: request.userId, action: "WITHDRAWN" }, { status: 200 });
      }

      return NextResponse.json({ error: "decision harus 'confirm' atau 'withdraw'." }, { status: 400 });
    } catch (error) {
      const refusal = domainErrorToHttp(error);
      if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
      throw error;
    }
  }
);
