import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";

const VALID_ASSIGNMENTS: Assignment[] = ["VERIFIER", "ADMIN"];

export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json();
  const { assignment } = body;

  if (!assignment || !VALID_ASSIGNMENTS.includes(assignment as Assignment)) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  const session = await getServerSession();
  const actedById = session!.user.id as string;

  await prisma.userAssignment.upsert({
    where: { userId_assignment: { userId: id, assignment: assignment as Assignment } },
    create: { userId: id, assignment: assignment as Assignment },
    update: {},
  });

  await prisma.assignmentAuditEntry.create({
    data: {
      userId: id,
      assignment: assignment as Assignment,
      action: "GRANTED",
      actedById,
    },
  });

  await prisma.notification.create({
    data: {
      type: "assignment_granted",
      title: "Assignment Granted",
      message: `You have been granted the ${assignment} assignment.`,
      userId: id,
      link: "/akun",
    },
  });

  return NextResponse.json({ userId: id, assignment, action: "GRANTED" }, { status: 201 });
});
