import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  let notificationIds: string[] | undefined;

  try {
    const body = await request.json();
    notificationIds = body.notificationIds;
  } catch {
    // If body is empty or invalid, mark all as read
    notificationIds = undefined;
  }

  const whereClause: Record<string, unknown> = {
    userId: session.user.id,
    isRead: false,
  };

  if (notificationIds && notificationIds.length > 0) {
    whereClause.id = { in: notificationIds };
  }

  const result = await prisma.notification.updateMany({
    where: whereClause,
    data: { isRead: true },
  });

  return NextResponse.json({
    updatedCount: result.count,
  });
}
