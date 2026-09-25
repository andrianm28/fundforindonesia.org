import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lifecycleErrorToHttp, requestCancellation } from "@/lib/campaign-lifecycle";

/**
 * POST /api/campaigns/[slug]/cancellation-requests `{ reason }`: the owner of
 * an Active Campaign asks to withdraw it. A thin adapter over the lifecycle
 * module, which owns the owner check, the status rule, the one-pending rule
 * and the reason validation. No assignment gate: the right to ask comes from
 * owning the Campaign, not from a role.
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

    const { slug } = await params;
    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign tidak ditemukan." }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const actor = {
      userId: session.user.id,
      assignments: session.user.assignments ?? [],
    };
    const result = await requestCancellation(prisma, {
      campaignId: campaign.id,
      actor,
      reason: body?.reason,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const refusal = lifecycleErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    console.error("Error requesting cancellation:", error);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}
