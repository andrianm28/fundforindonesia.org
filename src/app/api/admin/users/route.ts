import { NextRequest, NextResponse } from "next/server";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const GET = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "10", 10)));
  const search = searchParams.get("search") || undefined;

  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        assignments: { select: { assignment: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({ where }),
  ]);

  // Assignments are the only thing that grants power (ADR 0005), so they are
  // what the Admin sees and edits for each user.
  const users = rows.map(({ assignments, ...user }) => ({
    ...user,
    assignments: assignments.map((a) => a.assignment),
  }));

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  });
});
