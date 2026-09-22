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

export const DELETE = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json();
  const { assignment } = body;

  if (!assignment || !VALID_ASSIGNMENTS.includes(assignment as Assignment)) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  const session = await getServerSession();
  const actedById = session!.user.id as string;

  if (actedById === id && assignment === "ADMIN") {
    return NextResponse.json(
      { error: "Cannot revoke your own ADMIN assignment" },
      { status: 400 }
    );
  }

  const existing = await prisma.userAssignment.findUnique({
    where: { userId_assignment: { userId: id, assignment: assignment as Assignment } },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "User does not currently hold this assignment" },
      { status: 404 }
    );
  }

  await prisma.userAssignment.delete({
    where: { userId_assignment: { userId: id, assignment: assignment as Assignment } },
  });

  await prisma.assignmentAuditEntry.create({
    data: {
      userId: id,
      assignment: assignment as Assignment,
      action: "REVOKED",
      actedById,
    },
  });

  await prisma.notification.create({
    data: {
      type: "assignment_revoked",
      title: "Assignment Revoked",
      message: `Your ${assignment} assignment has been revoked.`,
      userId: id,
      link: "/akun",
    },
  });

  return NextResponse.json({ userId: id, assignment, action: "REVOKED" }, { status: 200 });
});
