import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CampaignNotFoundError,
  liftSuspension,
  lifecycleErrorToHttp,
  suspendCampaign,
} from "@/lib/campaign-lifecycle";

/**
 * Suspension of a Campaign as a resource: POST imposes it, DELETE lifts it
 * (ADR 0015, FFI-07b). Thin adapters over the lifecycle module, which owns
 * the Admin check, the own-Campaign and same-Admin rules, the transition,
 * the status-change record and the Fundraiser's notification.
 */
type Context = { params: Promise<{ slug: string }> };

type Command = typeof suspendCampaign | typeof liftSuspension;

async function handle(command: Command, req: NextRequest, context: Context) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actor = {
      userId: session.user.id,
      assignments: session.user.assignments ?? [],
    };

    const { slug } = await context.params;
    const body = await req.json().catch(() => null);
    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!campaign) throw new CampaignNotFoundError(slug);
    const result = await command(prisma, {
      campaignId: campaign.id,
      actor,
      reason: body?.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    const refusal = lifecycleErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    console.error("Error changing campaign suspension:", error);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}

export function POST(req: NextRequest, context: Context) {
  return handle(suspendCampaign, req, context);
}

export function DELETE(req: NextRequest, context: Context) {
  return handle(liftSuspension, req, context);
}
