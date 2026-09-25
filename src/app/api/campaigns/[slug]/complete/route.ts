import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CampaignNotFoundError,
  completeCampaign,
  lifecycleErrorToHttp,
} from "@/lib/campaign-lifecycle";

/**
 * Marks a Campaign Completed: its owner as Fundraiser, or an Admin who does
 * not own it, with a reason. A thin adapter over the lifecycle module, which
 * owns capacity, the reason rule, the Campaign Update requirement, the
 * transition, the status-change record and the Fundraiser's notification.
 * The body is optional: an owner may send none.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  const actor = {
    userId: session.user.id,
    assignments: session.user.assignments ?? [],
  };

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!campaign) throw new CampaignNotFoundError(slug);
    const result = await completeCampaign(prisma, {
      campaignId: campaign.id,
      actor,
      reason: body?.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    const refusal = lifecycleErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    console.error("Error completing campaign:", error);
    return NextResponse.json({ error: "Terjadi kesalahan pada server." }, { status: 500 });
  }
}
