import { NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { pendingAdminGrantRequests } from "@/lib/assignments";

/**
 * GET /api/admin/assignment-grant-requests (ticket 07/20; CONTEXT.md,
 * Admin): every PENDING two-person ADMIN grant proposal, oldest first, so
 * an Admin other than the proposer can see what is waiting for them to
 * confirm on POST .../[requestId]/decision. ADMIN only.
 */
export const GET = withAssignmentCheck(Assignment.ADMIN, async () => {
  const requests = await pendingAdminGrantRequests(prisma);
  return NextResponse.json({ requests }, { status: 200 });
});
