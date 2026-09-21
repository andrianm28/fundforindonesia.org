import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { Role, Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";

const VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json();
  const { role } = body;

  // Validate role value
  if (!role || !VALID_ROLES.includes(role as Role)) {
    return NextResponse.json(
      { error: "Invalid role" },
      { status: 400 }
    );
  }

  // Get current session for self-demotion check
  const session = await getServerSession();

  // Prevent self-demotion from ADMIN
  if (session!.user.id === id && role !== "ADMIN") {
    return NextResponse.json(
      { error: "Cannot remove ADMIN role from yourself" },
      { status: 400 }
    );
  }

  // Update user role in database
  const updatedUser = await prisma.user.update({
    where: { id },
    data: { role: role as Role },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  // Create notification for affected user about role change
  await prisma.notification.create({
    data: {
      type: "role_changed",
      title: "Role Updated",
      message: `Your role has been changed to ${role}`,
      userId: id,
      link: "/akun",
    },
  });

  return NextResponse.json({ user: updatedUser });
});
