import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CampaignNotFoundError,
  lifecycleErrorToHttp,
  setUrgent,
} from "@/lib/campaign-lifecycle";
import { NextRequest, NextResponse } from "next/server";

/**
 * An Admin sets or clears Urgent on a Campaign: `{ urgent: boolean, reason }`.
 * A thin adapter over the lifecycle module, which owns the Admin and
 * not-owner rules, the reason, the Active requirement, the predicated write
 * and the log row.
 */
export const PUT = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
  const { slug } = await context.params;
  const body = await req.json().catch(() => null);

  if (typeof body?.urgent !== "boolean") {
    return NextResponse.json(
      { error: "Kolom urgent wajib diisi true atau false." },
      { status: 400 }
    );
  }

  // withAssignmentCheck has already turned a missing session into 401.
  const session = await getServerSession();
  const actor = {
    userId: session!.user.id,
    assignments: session!.user.assignments ?? [],
  };

  try {
    const campaign = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
    if (!campaign) throw new CampaignNotFoundError(slug);
    const result = await setUrgent(prisma, {
      campaignId: campaign.id,
      actor,
      urgent: body.urgent,
      reason: body.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    const refusal = lifecycleErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    throw error;
  }
});
