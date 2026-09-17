import { withRoleCheck } from "@/lib/withRoleCheck";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const VALID_ACTIONS = ["approve", "reject", "suspend"] as const;
type ModerationAction = (typeof VALID_ACTIONS)[number];

const ACTION_STATUS_MAP: Record<ModerationAction, string> = {
  approve: "active",
  reject: "rejected",
  suspend: "suspended",
};

const ACTION_MESSAGE_MAP: Record<ModerationAction, string> = {
  approve: "Your campaign has been approved and is now active",
  reject: "Your campaign has been rejected by a moderator",
  suspend: "Your campaign has been suspended by a moderator",
};

export const PATCH = withRoleCheck("MODERATOR", async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json();
  const { action } = body;

  // Validate the action
  if (!action || !VALID_ACTIONS.includes(action as ModerationAction)) {
    return NextResponse.json(
      { error: "Invalid action. Must be one of: approve, reject, suspend" },
      { status: 400 }
    );
  }

  // Find the campaign to get creatorId for notification
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { id: true, creatorId: true, title: true },
  });

  if (!campaign) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  const validAction = action as ModerationAction;
  const newStatus = ACTION_STATUS_MAP[validAction];

  // Update campaign status
  const updatedCampaign = await prisma.campaign.update({
    where: { id },
    data: { status: newStatus },
  });

  // Create notification for the campaign creator
  await prisma.notification.create({
    data: {
      type: "campaign_moderation",
      title: "Campaign Moderation Update",
      message: ACTION_MESSAGE_MAP[validAction],
      userId: campaign.creatorId,
      link: `/campaign/${updatedCampaign.slug}`,
    },
  });

  return NextResponse.json({ campaign: updatedCampaign });
});
