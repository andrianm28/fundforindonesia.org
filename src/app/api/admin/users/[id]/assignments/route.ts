import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";

const VALID_ASSIGNMENTS: Assignment[] = ["VERIFIER", "ADMIN"];

class LastAdminAssignmentError extends Error {
  constructor() {
    super("Cannot revoke the last ADMIN assignment.");
    this.name = "LastAdminAssignmentError";
  }
}

export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json();
  const { assignment } = body;

  if (!assignment || !VALID_ASSIGNMENTS.includes(assignment as Assignment)) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  const session = await getServerSession();
  const actedById = session!.user.id as string;

  await prisma.$transaction(async (tx) => {
    await tx.userAssignment.upsert({
      where: { userId_assignment: { userId: id, assignment: assignment as Assignment } },
      create: { userId: id, assignment: assignment as Assignment },
      update: {},
    });

    await tx.assignmentAuditEntry.create({
      data: {
        userId: id,
        assignment: assignment as Assignment,
        action: "GRANTED",
        actedById,
      },
    });
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

  try {
    await prisma.$transaction(async (tx) => {
      if (assignment === "ADMIN") {
        // The contended resource is ADMIN headcount, not this row -- a second,
        // different admin's ADMIN assignment is a different row entirely and
        // would sail straight past a lock on this one. Locking the whole
        // ADMIN rowset is what serialises two admins concurrently revoking
        // two DIFFERENT admins' ADMIN assignment at once. Without it: the
        // count below is a plain SELECT with no row to lock, these
        // transactions run at Postgres's default READ COMMITTED (no
        // isolationLevel set anywhere in this repo), and each transaction
        // only locks its own UserAssignment row via the delete further down
        // -- so two concurrent revokes of two different admins would each
        // read the same pre-revoke count, each pass the check below, and
        // both commit, leaving zero ADMINs.
        await tx.$queryRaw`SELECT "userId" FROM "UserAssignment" WHERE assignment = 'ADMIN' FOR UPDATE`;

        const adminCount = await tx.userAssignment.count({ where: { assignment: "ADMIN" } });
        if (adminCount <= 1) {
          throw new LastAdminAssignmentError();
        }
      }

      await tx.userAssignment.delete({
        where: { userId_assignment: { userId: id, assignment: assignment as Assignment } },
      });

      await tx.assignmentAuditEntry.create({
        data: {
          userId: id,
          assignment: assignment as Assignment,
          action: "REVOKED",
          actedById,
        },
      });
    });
  } catch (error) {
    if (error instanceof LastAdminAssignmentError) {
      return NextResponse.json({ error: "Cannot revoke the last ADMIN assignment" }, { status: 400 });
    }
    throw error;
  }

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
