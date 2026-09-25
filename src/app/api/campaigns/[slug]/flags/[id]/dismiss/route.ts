import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CampaignNotFoundError,
  dismissFlag,
  lifecycleErrorToHttp,
} from "@/lib/campaign-lifecycle";

/**
 * POST /api/campaigns/[slug]/flags/[id]/dismiss `{ reason }`: an Admin who
 * is not the Campaign's Fundraiser dismisses an open Flag. A thin adapter
 * over the lifecycle module, which owns the Admin check, the own-Campaign
 * rule, the open-Flag check and the reason validation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
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

    const { slug, id } = await params;
    const body = await req.json().catch(() => null);
    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!campaign) throw new CampaignNotFoundError(slug);
    const result = await dismissFlag(prisma, {
      campaignId: campaign.id,
      flagId: id,
      actor,
      reason: body?.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    const refusal = lifecycleErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    console.error("Error dismissing flag:", error);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}
