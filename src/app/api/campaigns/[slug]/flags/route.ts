import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CampaignNotFoundError,
  flagCampaign,
  lifecycleErrorToHttp,
} from "@/lib/campaign-lifecycle";

/**
 * POST /api/campaigns/[slug]/flags `{ reason }`: a Verifier raises a Flag on
 * a Campaign so an Admin can decide on Suspension (FFI-07b). A thin adapter
 * over the lifecycle module, which owns the Verifier check, the status rule
 * (Active, Expired or Completed), the reason validation and the Campaign row
 * lock that serialises the Flag with a concurrent Suspension.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actor = {
      userId: session.user.id,
      assignments: session.user.assignments ?? [],
    };

    const { slug } = await params;
    const body = await req.json().catch(() => null);
    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!campaign) throw new CampaignNotFoundError(slug);
    const result = await flagCampaign(prisma, {
      campaignId: campaign.id,
      actor,
      reason: body?.reason,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const refusal = lifecycleErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    console.error("Error flagging campaign:", error);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}
