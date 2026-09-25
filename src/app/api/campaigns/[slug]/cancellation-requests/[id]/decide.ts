import { NextRequest, NextResponse } from "next/server";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  decideCancellation,
  lifecycleErrorToHttp,
  type CancellationDecision,
} from "@/lib/campaign-lifecycle";

/**
 * The shared body of `POST .../cancellation-requests/[id]/approve` and
 * `.../reject` `{ reason }`. A thin adapter over the lifecycle module, which
 * owns the not-owner rule, the pending check, the Payout check under the
 * Campaign row lock, the status write and the Fundraiser's notification. The
 * route gate only turns away anyone without the ADMIN assignment early.
 */
export function cancellationDecisionRoute(decision: CancellationDecision) {
  return withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
    const { slug, id } = await context.params;

    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign tidak ditemukan." }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    // withAssignmentCheck has already turned a missing session into 401.
    const session = await getServerSession();
    const actor = {
      userId: session!.user.id,
      assignments: session!.user.assignments ?? [],
    };

    try {
      const result = await decideCancellation(prisma, {
        campaignId: campaign.id,
        requestId: id,
        actor,
        decision,
        reason: body?.reason,
      });
      return NextResponse.json(result);
    } catch (error) {
      const refusal = lifecycleErrorToHttp(error);
      if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
      throw error;
    }
  });
}
